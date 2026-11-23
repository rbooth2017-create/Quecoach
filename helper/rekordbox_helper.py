"""Cue Coach rekordbox helper.

A small local server that reads your rekordbox 6/7 library (master.db) with
pyrekordbox and gives the Cue Coach web app:

  GET /status              helper + library status
  GET /library             all tracks (title, artist, BPM, key, cues, ...)
  GET /track/<id>          one track with its beat grid and rekordbox phrases
  GET /now-playing         the newest track in rekordbox's play history
  GET /audio/<id>          the audio file of a library track

It only listens on 127.0.0.1 and only answers the Cue Coach page.
It never writes to the rekordbox database.

Run:  python3 helper/rekordbox_helper.py
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import unquote

# The app (npm start / the desktop app) is on 8642; 8650-8654 are the development preview servers (.claude/launch.json).
ALLOWED_PORTS = (8642, 8650, 8651, 8652, 8653, 8654)
ALLOWED_ORIGINS = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in ALLOWED_PORTS}

# rekordbox hot cue slots stored in DjmdCue.Kind (0 = memory cue, 4 = loop marker)
HOT_CUE_LETTER = {1: "A", 2: "B", 3: "C", 5: "D", 6: "E", 7: "F", 8: "G", 9: "H"}

# rekordbox phrase analysis (PSSI) labels by mood
PHRASE_NAMES = {
    1: {1: "Intro", 2: "Up", 3: "Down", 5: "Chorus", 6: "Outro"},  # high
    2: {1: "Intro", 2: "Verse 1", 3: "Verse 2", 4: "Verse 3", 5: "Verse 4", 6: "Verse 5",
        7: "Verse 6", 8: "Bridge", 9: "Chorus", 10: "Outro"},  # mid
    3: {1: "Intro", 2: "Verse 1", 3: "Verse 1", 4: "Verse 1", 5: "Verse 2", 6: "Verse 2",
        7: "Verse 2", 8: "Bridge", 9: "Chorus", 10: "Outro"},  # low
}
MOOD_NAMES = {1: "high", 2: "mid", 3: "low"}


# ---------------------------------------------------------------- pure helpers

def grid_from_beats(beats: Sequence[int], bpms: Sequence[float], times: Sequence[float]) -> Optional[Dict[str, Any]]:
    """Beat grid in Cue Coach's format from rekordbox PQTZ arrays.

    beats: beat number in the bar (1-4) of each grid beat
    bpms:  tempo at each beat
    times: time of each beat in seconds
    """
    if not len(times):
        return None
    first_one = next((i for i, b in enumerate(beats) if int(b) == 1), 0)
    bpm = float(bpms[first_one]) or float(bpms[0])
    t = float(times[first_one])
    bar = 240.0 / bpm
    while t >= bar:  # earliest downbeat that is still >= 0
        t -= bar
    tempo_changes = sorted({round(float(b), 2) for b in bpms})
    return {"bpm": round(bpm, 2), "firstDownbeat": round(t, 4), "variableTempo": len(tempo_changes) > 1}


def phrases_from_pssi(mood: int, end_beat: int, entries: Sequence[Dict[str, int]], beat_times: Sequence[float],
                      duration: float) -> List[Dict[str, Any]]:
    """rekordbox phrase analysis → [{label, startBeat, start, end}] (seconds)."""
    names = PHRASE_NAMES.get(mood, {})

    def time_of(beat: int) -> float:
        if 1 <= beat <= len(beat_times):
            return float(beat_times[beat - 1])
        return duration

    out = []
    ordered = sorted(entries, key=lambda e: e["beat"])
    for i, e in enumerate(ordered):
        nxt = ordered[i + 1]["beat"] if i + 1 < len(ordered) else end_beat
        out.append({
            "label": names.get(e["kind"], f"Phrase {e['kind']}"),
            "startBeat": e["beat"],
            "start": round(time_of(e["beat"]), 3),
            "end": round(time_of(nxt), 3),
        })
    return out


def file_path(content: Any) -> Optional[Path]:
    p = content.FolderPath
    if not p:
        return None
    path = Path(p)
    return path if path.name else None


# ---------------------------------------------------------------- library access

class Library:
    def __init__(self, db_path: Optional[str], key: Optional[str], unlocked: bool):
        from pyrekordbox import Rekordbox6Database  # imported here so --help works without it

        kwargs: Dict[str, Any] = {}
        if db_path:
            kwargs["path"] = db_path
        if key:
            kwargs["key"] = key
        if unlocked:
            kwargs["unlock"] = False
        self.db = Rekordbox6Database(**kwargs)
        self.lock = threading.Lock()
        self._detail_cache: Dict[str, Dict[str, Any]] = {}

    def _fresh(self) -> None:
        # rekordbox keeps writing while it runs; drop SQLAlchemy's cached rows.
        self.db.session.expire_all()

    @staticmethod
    def _cues(content: Any) -> List[Dict[str, Any]]:
        cues = []
        for c in content.Cues or []:
            if c.InMsec is None or c.InMsec < 0:
                continue
            is_loop = c.OutMsec is not None and c.OutMsec > c.InMsec
            num = -1 if c.Kind == 0 else "ABCDEFGH".find(HOT_CUE_LETTER.get(c.Kind, "?"))
            cues.append({"name": c.Comment or "", "time": c.InMsec / 1000.0, "num": num, "loop": bool(is_loop)})
        return sorted(cues, key=lambda c: c["time"])

    @staticmethod
    def _basic(content: Any) -> Dict[str, Any]:
        bpm = (content.BPM or 0) / 100.0
        comment = content.Commnt or ""
        energy = re.search(r"energy\s*(\d{1,2})", comment, re.I)
        path = file_path(content)
        try:
            play_count = int(content.DJPlayCount or 0)
        except ValueError:
            play_count = 0
        return {
            "id": str(content.ID),
            "title": content.Title or (path.name if path else ""),
            "artist": content.ArtistName or "",
            "genre": content.GenreName or "",
            "bpm": bpm,
            "key": content.KeyName or "",
            "duration": content.Length or 0,
            "rating": int(content.Rating or 0),
            "playCount": play_count,
            "energy": int(energy.group(1)) if energy else None,
            "fileName": path.name if path else "",
            "location": "",
            "path": str(path) if path else "",  # lets the desktop app hand the file to rekordbox by drag
            "helper": True,
            # A rough grid until /track/<id> reads the real one from the analysis files.
            "grid": {"bpm": bpm, "firstDownbeat": 0.0, "approx": True} if bpm else None,
            "cues": Library._cues(content),
        }

    def library(self) -> List[Dict[str, Any]]:
        with self.lock:
            self._fresh()
            out = []
            for c in self.db.get_content():
                if getattr(c, "rb_local_deleted", 0):
                    continue
                out.append(self._basic(c))
            return out

    def track(self, track_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            if track_id in self._detail_cache:
                return self._detail_cache[track_id]
            c = self.db.get_content(ID=track_id)
            if c is None:
                return None
            t = self._basic(c)
            t["phrases"] = []
            t["mood"] = None
            try:
                dat = self.db.read_anlz_file(c, "DAT")
                if dat is not None and "PQTZ" in dat:
                    beats, bpms, times = dat.get("PQTZ")
                    grid = grid_from_beats(list(beats), list(bpms), list(times))
                    if grid:
                        t["grid"] = grid
                        t["bpm"] = grid["bpm"]
                    ext = self.db.read_anlz_file(c, "EXT")
                    if ext is not None and "PSSI" in ext:
                        pssi = ext.get_tag("PSSI").content
                        entries = [{"beat": e.beat, "kind": e.kind} for e in pssi.entries]
                        t["mood"] = MOOD_NAMES.get(pssi.mood)
                        t["phrases"] = phrases_from_pssi(pssi.mood, pssi.end_beat, entries, list(times), t["duration"])
            except Exception as err:  # analysis files missing or unreadable: keep the rough grid
                t["analysisError"] = str(err)
            self._detail_cache[track_id] = t
            return t

    def now_playing(self) -> Dict[str, Any]:
        from pyrekordbox.db6 import tables

        with self.lock:
            self._fresh()
            s = self.db.session
            SH = tables.DjmdSongHistory
            # The most recently added history row is the track rekordbox logged last.
            last = s.query(SH).order_by(SH.created_at.desc(), SH.TrackNo.desc()).first()
            if last is None:
                return {"track": None, "history": [], "historyName": None}
            hist = last.History
            songs = s.query(SH).filter(SH.HistoryID == last.HistoryID).order_by(SH.TrackNo).all()
            ids = [str(x.ContentID) for x in songs]
            latest = songs[-1].Content if songs else None
            return {
                "track": self._basic(latest) if latest is not None else None,
                "history": ids,
                "historyName": hist.Name if hist is not None else None,
            }

    def audio_path(self, track_id: str) -> Optional[Path]:
        with self.lock:
            c = self.db.get_content(ID=track_id)
            path = file_path(c) if c is not None else None
        return path if path and path.is_file() else None


# ---------------------------------------------------------------- HTTP

def make_handler(lib: Library):
    class Handler(BaseHTTPRequestHandler):
        server_version = "CueCoachHelper/1.0"

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                # Chrome asks before a public page talks to a local server.
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _json(self, data: Any, status: int = 200) -> None:
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            origin = self.headers.get("Origin")
            if origin and origin not in ALLOWED_ORIGINS:
                return self._json({"error": "origin not allowed"}, 403)
            path = unquote(self.path.split("?")[0])
            try:
                if path == "/status":
                    return self._json({"ok": True, "tracks": len(lib.library())})
                if path == "/library":
                    return self._json(lib.library())
                if path == "/now-playing":
                    return self._json(lib.now_playing())
                m = re.fullmatch(r"/track/([\w-]+)", path)
                if m:
                    t = lib.track(m.group(1))
                    return self._json(t) if t else self._json({"error": "not found"}, 404)
                m = re.fullmatch(r"/audio/([\w-]+)", path)
                if m:
                    return self._audio(m.group(1))
                return self._json({"error": "not found"}, 404)
            except Exception as err:  # report instead of dropping the connection
                return self._json({"error": f"{type(err).__name__}: {err}"}, 500)

        def _audio(self, track_id: str) -> None:
            p = lib.audio_path(track_id)
            if p is None:
                return self._json({"error": "audio file not found on disk"}, 404)
            size = p.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self._cors()
            self.end_headers()
            with p.open("rb") as f:
                while chunk := f.read(1 << 20):
                    self.wfile.write(chunk)

        def log_message(self, fmt: str, *args: Any) -> None:
            if "now-playing" not in (args[0] if args else ""):
                sys.stderr.write("  %s\n" % (fmt % args))

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve your rekordbox library to Cue Coach (read-only).")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", help="path to master.db (found automatically by default)")
    ap.add_argument("--key", help="database key, only if automatic key lookup fails")
    ap.add_argument("--unlocked", action="store_true", help="the database is not encrypted (test databases)")
    args = ap.parse_args()
    try:
        lib = Library(args.db, args.key, args.unlocked)
        n = len(lib.library())
    except Exception as err:
        sys.exit(f"Could not open the rekordbox library: {type(err).__name__}: {err}\n"
                 "Is rekordbox 6 or 7 installed and has it been opened at least once?")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(lib))
    print(f"Cue Coach helper: {n} tracks. Listening on http://127.0.0.1:{args.port} (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
