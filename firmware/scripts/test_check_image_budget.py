"""check_image_budget.py must fail when it cannot read the index, not pass."""

import subprocess
import sys
from pathlib import Path

CHECK = Path(__file__).with_name("check_image_budget.py")
PARTITIONS = Path(__file__).resolve().parents[1] / "partitions.csv"
PACK = Path(__file__).resolve().parents[1] / "tools" / "pack_assets.py"


def run_check(tmp_path: Path, header: Path) -> subprocess.CompletedProcess:
    app = tmp_path / "app.bin"
    app.write_bytes(b"\0" * 1024)
    return subprocess.run(
        [sys.executable, str(CHECK), str(PARTITIONS), str(app), str(header)],
        capture_output=True,
        text=True,
    )


def packed_header(tmp_path: Path) -> Path:
    audio = tmp_path / "audio"
    audio.mkdir()
    (audio / "1.wav").write_bytes(b"x" * 100)
    (audio / "2.wav").write_bytes(b"y" * 50)
    out = tmp_path / "out"
    subprocess.run(
        [sys.executable, str(PACK), str(out / "e.bin"), str(out / "i.h"), str(out / "b.S"), f"audio={audio}"],
        check=True,
        capture_output=True,
    )
    return out / "i.h"


def test_the_packers_own_index_is_read(tmp_path):
    result = run_check(tmp_path, packed_header(tmp_path))
    assert result.returncode == 0, result.stderr
    assert "audio" in result.stdout and "150 B" in result.stdout


def test_an_index_in_a_format_it_cannot_parse_fails(tmp_path):
    header = packed_header(tmp_path)
    # Designated initialisers: valid C++, and invisible to the regex.
    header.write_text(header.read_text().replace('{"', '{.path = "'))
    result = run_check(tmp_path, header)
    assert result.returncode != 0
    assert "parsed 0 entries" in result.stderr


def test_an_index_partly_parsed_fails(tmp_path):
    header = packed_header(tmp_path)
    header.write_text(header.read_text().replace('{"/audio/2.wav"', '{ "/audio/2.wav"'))
    result = run_check(tmp_path, header)
    assert result.returncode != 0
    assert "declares 2" in result.stderr


def test_an_empty_index_fails(tmp_path):
    out = tmp_path / "out"
    subprocess.run(
        [sys.executable, str(PACK), str(out / "e.bin"), str(out / "i.h"), str(out / "b.S")],
        check=True,
        capture_output=True,
    )
    result = run_check(tmp_path, out / "i.h")
    assert result.returncode != 0
