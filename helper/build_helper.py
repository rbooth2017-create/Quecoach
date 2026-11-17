"""Build the rekordbox helper as one standalone program (no Python needed to run it).

Run on each operating system you ship for (PyInstaller can't cross-compile):
    python helper/build_helper.py
Output: dist-helper/cuecoach-helper/ — a folder holding cuecoach-helper (cuecoach-helper.exe on Windows)
"""
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent

PyInstaller.__main__.run([
    str(ROOT / "helper" / "rekordbox_helper.py"),
    "--onedir",  # one process (onefile spawns a child that can outlive a kill on Windows)
    "--name", "cuecoach-helper",
    "--distpath", str(ROOT / "dist-helper"),
    "--workpath", str(ROOT / "build" / "pyinstaller"),
    "--specpath", str(ROOT / "build" / "pyinstaller"),
    # pyrekordbox ships data files and loads parts lazily; sqlcipher3 is a native module.
    "--collect-all", "pyrekordbox",
    "--collect-all", "sqlcipher3",
    "--hidden-import", "pyrekordbox.db6.tables",
    "--noconfirm",
    "--clean",
])
