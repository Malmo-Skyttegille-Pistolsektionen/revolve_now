"""pack_assets.py, checked by reading its output the way the firmware does.

The reader below follows main/storage/embedded_fs.cpp rather than the packer's
docstring: `kEntries[] = {RT_EMBEDDED_ENTRIES}` as {path, offset, size}, a
linear strcmp lookup, bytes at `rt_embedded_start + offset`, and a lone
`{"", 0, 0}` meaning no files at all.
"""

import gzip
import os
import re
import subprocess
import sys
from pathlib import Path

PACK = Path(__file__).with_name("pack_assets.py")

ENTRY = re.compile(r'\{"((?:[^"\\]|\\.)*)",\s*(\d+),\s*(\d+)\}')


def pack(tmp_path: Path, *mounts: str) -> tuple[Path, Path, Path]:
    out = tmp_path / "out"
    blob, header, asm = out / "embedded.bin", out / "index.h", out / "blob.S"
    # As CMake runs it: the script by path, from a working directory that is
    # not the script's own.
    subprocess.run(
        [sys.executable, str(PACK), str(blob), str(header), str(asm), *mounts],
        check=True,
        cwd=tmp_path,
        capture_output=True,
    )
    return blob, header, asm


def read_index(header: Path) -> list[tuple[str, int, int]]:
    text = header.read_text()
    define = text.split("#define RT_EMBEDDED_ENTRIES", 1)[1]
    entries = []
    for path, offset, size in ENTRY.findall(define):
        # The packer escapes `\` and `"`; the C compiler is what undoes it.
        path = re.sub(r"\\(.)", r"\1", path)
        entries.append((path, int(offset), int(size)))
    return entries


class EmbeddedFs:
    def __init__(self, blob: Path, header: Path):
        self.data = blob.read_bytes()
        self.entries = read_index(header)

    def file_count(self) -> int:
        if len(self.entries) == 1 and self.entries[0][0] == "":
            return 0
        return len(self.entries)

    def read(self, path: str) -> bytes:
        for name, offset, size in self.entries:
            if name == path:
                return self.data[offset : offset + size]
        raise FileNotFoundError(path)


def make_tree(root: Path, files: dict[str, bytes]) -> Path:
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return root


def test_round_trip_including_an_empty_file_and_gzip(tmp_path):
    raw = make_tree(
        tmp_path / "raw",
        {"a.bin": b"\x01\x02\x03", "empty.json": b"", "sub/b.txt": b"hello", "z.json": b"{}"},
    )
    web = make_tree(
        tmp_path / "web",
        {"index.html": b"<!doctype html>" * 50, "logo.png": b"\x89PNG not text"},
    )

    blob, header, asm = pack(tmp_path, f"raw={raw}", f"gz:webapp={web}")
    fs = EmbeddedFs(blob, header)

    # Raw mounts are stored verbatim, the empty file included.
    assert fs.read("/raw/a.bin") == b"\x01\x02\x03"
    assert fs.read("/raw/empty.json") == b""
    assert fs.read("/raw/sub/b.txt") == b"hello"
    assert fs.read("/raw/z.json") == b"{}"

    # A gz: mount ships only the .gz of text assets; images stay as they are.
    assert gzip.decompress(fs.read("/webapp/index.html.gz")) == b"<!doctype html>" * 50
    assert fs.read("/webapp/logo.png") == b"\x89PNG not text"
    names = [name for name, _, _ in fs.entries]
    assert "/webapp/index.html" not in names

    assert fs.file_count() == 6
    assert names == sorted(names)
    assert all(offset % 4 == 0 for _, offset, _ in fs.entries)
    assert f"// {fs.file_count()} file(s), {len(fs.data)} bytes" in header.read_text()
    assert f'.incbin "{blob}"' in asm.read_text()


def test_an_absent_directory_yields_the_sentinel_not_an_empty_array(tmp_path):
    blob, header, _ = pack(tmp_path, f"webapp={tmp_path / 'no-such-dist'}")
    fs = EmbeddedFs(blob, header)
    assert fs.entries == [("", 0, 0)]
    assert fs.file_count() == 0
    assert fs.data == b""


def test_a_path_needing_c_escapes_survives(tmp_path):
    root = make_tree(tmp_path / "raw", {'quo"te.txt': b"q", "back\\slash.txt": b"b"})
    blob, header, _ = pack(tmp_path, f"raw={root}")
    fs = EmbeddedFs(blob, header)
    assert fs.read('/raw/quo"te.txt') == b"q"
    assert fs.read("/raw/back\\slash.txt") == b"b"


def test_output_is_deterministic_and_an_unchanged_rerun_writes_nothing(tmp_path):
    root = make_tree(tmp_path / "web", {"app.js": b"console.log(1)", "x.css": b"a{}"})
    blob, header, asm = pack(tmp_path, f"gz:webapp={root}")
    first = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (blob, header, asm)}

    # Push the clock back, so a rewrite would show even on a coarse filesystem.
    for path in first:
        os.utime(path, ns=(1, 1))
    pack(tmp_path, f"gz:webapp={root}")
    for path, (data, _) in first.items():
        assert path.read_bytes() == data
        assert path.stat().st_mtime_ns == 1
