"""Helpers shared by the build-time tools in this directory.

Imported as a sibling module: CMake runs each tool as `python <path>/tool.py`,
which puts this directory first on sys.path whatever the working directory.
"""


def write_if_changed(path: str, data: bytes) -> None:
    """Leave an unchanged output alone, so its mtime does not trigger a rebuild.

    The tools run on every build; a rewritten-but-identical file would repack
    the image and relink every time.
    """
    try:
        with open(path, "rb") as handle:
            if handle.read() == data:
                return
    except OSError:
        pass
    with open(path, "wb") as handle:
        handle.write(data)
