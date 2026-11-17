"""Tests for the rekordbox helper against a fake (unencrypted) rekordbox database.

Run: .venv/bin/python -m unittest helper/test_helper.py
"""
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import rekordbox_helper as rh  # noqa: E402


def row(cls, **kw):
    """Fill NOT NULL columns the test doesn't care about."""
    import uuid
    for col in cls.__table__.columns:
        if col.name in kw or col.nullable or col.primary_key or col.default is not None:
            continue
        kw[col.name] = str(uuid.uuid4()) if col.name == "UUID" else ("" if col.type.python_type is str else 0)
    return cls(**kw)


def build_fake_db(root: Path) -> Path:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from pyrekordbox.db6 import tables as T

    db = root / "master.db"
    engine = create_engine(f"sqlite:///{db}")
    T.Base.metadata.create_all(engine)
    audio = root / "Music" / "Kora Vale - Tides.mp3"
    audio.parent.mkdir()
    audio.write_bytes(b"ID3fakeaudio" * 100)
    t0 = datetime(2026, 11, 17, 22, 0, 0)
    with Session(engine) as s:
        s.add_all([
            row(T.DjmdArtist, ID="a1", Name="Kora Vale"), row(T.DjmdArtist, ID="a2", Name="Ferro"),
            row(T.DjmdGenre, ID="g1", Name="Tech House"),
            row(T.DjmdKey, ID="k1", ScaleName="Am"), row(T.DjmdKey, ID="k2", ScaleName="Em"),
            row(T.DjmdContent, ID="101", Title="Tides", ArtistID="a1", GenreID="g1", KeyID="k1", BPM=12450, Length=360,
                          Rating=4, DJPlayCount="3", Commnt="Energy 6 - peak", FolderPath=str(audio)),
            row(T.DjmdContent, ID="102", Title="Orbit", ArtistID="a2", GenreID="g1", KeyID="k2", BPM=12600, Length=400,
                          Rating=0, FolderPath="/nope/Orbit.mp3"),
            row(T.DjmdCue, ID="c1", ContentID="101", InMsec=480, OutMsec=-1, Kind=0, Comment="Start"),
            row(T.DjmdCue, ID="c2", ContentID="101", InMsec=62000, OutMsec=-1, Kind=1, Comment="Drop"),
            row(T.DjmdCue, ID="c3", ContentID="101", InMsec=93000, OutMsec=100700, Kind=5, Comment="Loop"),
            row(T.DjmdHistory, ID="h1", Name="2026-11-17", Attribute=0, DateCreated="2026-11-17"),
            row(T.DjmdSongHistory, ID="s1", HistoryID="h1", ContentID="102", TrackNo=1, created_at=t0),
            row(T.DjmdSongHistory, ID="s2", HistoryID="h1", ContentID="101", TrackNo=2, created_at=t0 + timedelta(minutes=5)),
        ])
        s.commit()
    return db


class PureFunctions(unittest.TestCase):
    def test_grid_from_beats(self):
        beat = 60 / 124
        # grid starts on beat 3 at 0.5 s → downbeat is 2 beats later
        times = [0.5 + i * beat for i in range(16)]
        beats = [((2 + i) % 4) + 1 for i in range(16)]
        g = rh.grid_from_beats(beats, [124.0] * 16, times)
        self.assertEqual(g["bpm"], 124.0)
        self.assertAlmostEqual(g["firstDownbeat"], 0.5 + 2 * beat, places=3)
        self.assertFalse(g["variableTempo"])

    def test_phrases(self):
        times = [i * 0.5 for i in range(400)]
        ph = rh.phrases_from_pssi(1, 257, [{"beat": 65, "kind": 2}, {"beat": 1, "kind": 1}, {"beat": 129, "kind": 5}], times, 200)
        self.assertEqual([p["label"] for p in ph], ["Intro", "Up", "Chorus"])
        self.assertEqual(ph[0]["start"], 0.0)
        self.assertEqual(ph[1]["start"], 32.0)
        self.assertEqual(ph[2]["end"], 128.0)


class WithFakeDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        db = build_fake_db(Path(cls.tmp.name))
        cls.lib = rh.Library(str(db), None, unlocked=True)
        cls.server = rh.ThreadingHTTPServer(("127.0.0.1", 0), rh.make_handler(cls.lib))
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.lib.db.close()
        cls.tmp.cleanup()

    def get(self, path, origin="http://localhost:8642"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers={"Origin": origin})
        return urllib.request.urlopen(req)

    def test_library(self):
        tracks = {t["id"]: t for t in self.lib.library()}
        t = tracks["101"]
        self.assertEqual((t["title"], t["artist"], t["genre"], t["key"]), ("Tides", "Kora Vale", "Tech House", "Am"))
        self.assertEqual(t["bpm"], 124.5)
        self.assertEqual(t["energy"], 6)
        self.assertEqual(t["playCount"], 3)
        self.assertEqual(t["fileName"], "Kora Vale - Tides.mp3")
        cues = t["cues"]
        self.assertEqual([c["num"] for c in cues], [-1, 0, 3])  # memory, hot A, hot D
        self.assertEqual([c["loop"] for c in cues], [False, False, True])
        self.assertTrue(t["grid"]["approx"])

    def test_track_without_analysis_files_keeps_rough_grid(self):
        t = self.lib.track("101")
        self.assertEqual(t["grid"]["bpm"], 124.5)
        self.assertEqual(t["phrases"], [])

    def test_now_playing_is_latest_history_entry(self):
        np_ = self.lib.now_playing()
        self.assertEqual(np_["track"]["id"], "101")
        self.assertEqual(np_["history"], ["102", "101"])

    def test_http_endpoints_and_cors(self):
        r = self.get("/status")
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], "http://localhost:8642")
        self.assertEqual(json.load(r)["tracks"], 2)
        self.assertEqual(json.load(self.get("/now-playing"))["track"]["title"], "Tides")
        self.assertEqual(len(self.get("/audio/101").read()), 1200)
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.get("/audio/102")
        self.assertEqual(e.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.get("/library", origin="https://evil.example")
        self.assertEqual(e.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.get("/audio/..%2F..%2Fetc%2Fpasswd")
        self.assertEqual(e.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
