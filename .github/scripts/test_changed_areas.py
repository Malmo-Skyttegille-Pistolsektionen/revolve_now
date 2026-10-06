from changed_areas import touched


def test_docs_only_touches_nothing():
    assert touched(["docs/site/index.md", "README.md", "firmware/docs/QEMU.md", "hardware/esp.kicad_sch"]) == {
        "firmware": False,
        "webapp": False,
        "contracts": False,
        "e2e": False,
    }


def test_webapp_only_skips_firmware_but_not_e2e():
    assert touched(["webapp/src/App.tsx"]) == {"firmware": False, "webapp": True, "contracts": False, "e2e": True}


def test_webapp_markdown_is_still_webapp():
    # webapp/test/theme-tokens.test.ts reads DESIGN.md.
    assert touched(["webapp/DESIGN.md"])["webapp"]


def test_firmware_only_skips_webapp_build():
    assert touched(["firmware/main/main.cpp"]) == {"firmware": True, "webapp": False, "contracts": False, "e2e": True}


def test_seams_run_everything():
    for path in (".github/workflows/lint.yml", "contracts/openapi.yaml", "resources/programs/files/40.json"):
        assert all(touched([path]).values()), path


def test_unknown_path_runs_everything():
    assert all(touched([".gitattributes"]).values())


def test_prefix_is_a_directory_not_a_string_prefix():
    assert all(touched(["docsy.txt"]).values())
    assert touched(["firmware/docs.cpp"]) == {"firmware": True, "webapp": False, "contracts": False, "e2e": True}


def test_no_paths_touches_nothing():
    assert not any(touched([]).values())
