#!/usr/bin/env python3
"""`hardware` in `backup.schema.json` is `HardwareConfigPatch` from `openapi.yaml`,
written out rather than referenced, for the reason `check_program_schema.py`
gives. This resolves both and fails when their structure drifts apart. Prose
and `format` are allowed to differ.
"""

import json
import sys
from pathlib import Path

from ruamel.yaml import YAML  # installed with check-jsonschema, which validate.sh already needs

HERE = Path(__file__).resolve().parent
IGNORED = {"description", "format", "example", "examples"}


def resolve(node, root):
    if isinstance(node, dict):
        if "$ref" in node:
            target = root
            for part in node["$ref"].lstrip("#/").split("/"):
                target = target[part]
            return resolve(target, root)
        if set(node) - IGNORED == {"allOf"} and len(node["allOf"]) == 1:
            return resolve(node["allOf"][0], root)
        return {k: resolve(v, root) for k, v in node.items() if k not in IGNORED}
    if isinstance(node, list):
        return [resolve(item, root) for item in node]
    return node


def main() -> int:
    openapi = YAML(typ="safe").load((HERE / "openapi.yaml").read_text(encoding="utf-8"))
    schema = json.loads((HERE / "backup.schema.json").read_text(encoding="utf-8"))
    api: dict = resolve(openapi["components"]["schemas"]["HardwareConfigPatch"], openapi)
    backup: dict = resolve(schema["properties"]["hardware"], schema)
    if api == backup:
        return 0
    for field in sorted(set(api.get("properties", {})) | set(backup.get("properties", {}))):
        a, b = api["properties"].get(field), backup["properties"].get(field)
        if a != b:
            print(f"hardware.{field}: {a} in openapi.yaml, {b} in backup.schema.json", file=sys.stderr)
    rest_a = {k: v for k, v in api.items() if k != "properties"}
    rest_b = {k: v for k, v in backup.items() if k != "properties"}
    if rest_a != rest_b:
        print(f"hardware: {rest_a} in openapi.yaml, {rest_b} in backup.schema.json", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
