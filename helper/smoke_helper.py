"""Smoke-test the BUILT helper program (not the Python source).

Builds a fake rekordbox library, encrypts it the way rekordbox does (SQLCipher, rekordbox's key),
starts dist-helper/cuecoach-helper/cuecoach-helper(.exe) against it and checks it answers.
This catches problems that only show up in the packaged program, e.g. a missing SQLCipher DLL.

Run after build_helper.py:  python helper/smoke_helper.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "helper"))
from test_helper import build_fake_db  # noqa: E402

PORT = 8799
EXE = ROOT / "dist-helper" / "cuecoach-helper" / ("cuecoach-helper.exe" if sys.platform == "win32" else "cuecoach-helper")


def encrypt(plain: Path, enc: Path) -> None:
    """Copy the plain SQLite library into a SQLCipher-encrypted one with rekordbox's key."""
    import sqlcipher3
    from pyrekordbox.db6.database import BLOB
    from pyrekordbox.utils import deobfuscate

    key = deobfuscate(BLOB)
    con = sqlcipher3.connect(str(plain))
    con.execute(f"ATTACH DATABASE '{enc.as_posix()}' AS encrypted KEY '{key}'")
    con.execute("SELECT sqlcipher_export('encrypted')")
    con.execute("DETACH DATABASE encrypted")
    con.close()


def get(path: str):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", headers={"Origin": "http://127.0.0.1:8642"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.load(r)


def main() -> int:
    if not EXE.exists():
        print(f"helper program not found: {EXE}")
        return 1
    root = Path(tempfile.mkdtemp())
    try:
        plain = build_fake_db(root)
        enc_dir = root / "encrypted"
        enc_dir.mkdir()
        enc = enc_dir / "master.db"
        encrypt(plain, enc)
        proc = subprocess.Popen([str(EXE), "--db", str(enc), "--port", str(PORT)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            status = None
            for _ in range(90):  # first start of a packaged program can be slow (antivirus scans)
                if proc.poll() is not None:
                    print("helper exited early:\n" + (proc.stdout.read() if proc.stdout else ""))
                    return 1
                try:
                    status = get("/status")
                    break
                except Exception:
                    time.sleep(1)
            if not status:
                print("helper never answered")
                return 1
            now = get("/now-playing")
            library = get("/library")
            assert status == {"ok": True, "tracks": 2}, status
            assert now["track"]["title"] == "Tides", now
            assert {t["title"] for t in library} == {"Tides", "Orbit"}, library
            print(f"OK: built helper opened an encrypted library ({status['tracks']} tracks, now playing {now['track']['title']})")
            return 0
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    finally:
        shutil.rmtree(root, ignore_errors=True)  # Windows may keep files locked for a moment


if __name__ == "__main__":
    sys.exit(main())
