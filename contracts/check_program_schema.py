#!/usr/bin/env python3
"""`Program`, `Series` and `Event` are written down twice: in `openapi.yaml`, as
what the device sends and accepts, and in `program.schema.json`, as the authoring
schema for the files in `resources/programs/files/`.

They are not one schema by reference. A `$ref` into the JSON Schema makes
openapi-typescript inline its `$defs` into `Program` and turn every `default`
into a required field, so `generated.d.ts` stops meaning what it says. Instead
this compares the structure the two must agree on - field names, `required`,
enums, `minimum`, `additionalProperties` - and fails on drift. Prose is allowed
to differ: the two have different readers.
"""

import json
import sys
from pathlib import Path

from ruamel.yaml import YAML  # installed with check-jsonschema, which validate.sh already needs

HERE = Path(__file__).resolve().parent

# Fields the authoring schema accepts so v1-era files still validate, and the
# API neither emits nor documents.
SCHEMA_ONLY = {"Event": {"target_system", "start"}}

SHAPE_KEYS = ("required", "enum", "minimum", "additionalProperties")


def shape(node: dict) -> dict:
    return {k: node[k] for k in SHAPE_KEYS if k in node}


def compare(name: str, api: dict, authoring: dict) -> list[str]:
    problems = []
    api_props = api.get("properties", {})
    auth_props = authoring.get("properties", {})

    for field in sorted(set(api_props) - set(auth_props)):
        problems.append(f"{name}.{field}: in openapi.yaml, missing from program.schema.json")
    for field in sorted(set(auth_props) - set(api_props) - SCHEMA_ONLY.get(name, set())):
        problems.append(f"{name}.{field}: in program.schema.json, missing from openapi.yaml")

    if shape(api) != shape(authoring):
        problems.append(f"{name}: {shape(api)} in openapi.yaml, {shape(authoring)} in program.schema.json")

    for field in sorted(set(api_props) & set(auth_props)):
        a, b = shape(api_props[field]), shape(auth_props[field])
        # `items` carries the element type of audio_ids; compare it too.
        if "items" in api_props[field] or "items" in auth_props[field]:
            a["items"] = api_props[field].get("items", {}).get("type")
            b["items"] = auth_props[field].get("items", {}).get("type")
        if a != b:
            problems.append(f"{name}.{field}: {a} in openapi.yaml, {b} in program.schema.json")
    return problems


def main() -> int:
    openapi = YAML(typ="safe").load((HERE / "openapi.yaml").read_text(encoding="utf-8"))
    schema = json.loads((HERE / "program.schema.json").read_text(encoding="utf-8"))
    api = openapi["components"]["schemas"]

    pairs = {"Program": (api["Program"], schema)}
    for name in ("Series", "Event"):
        pairs[name] = (api[name], schema["$defs"][name])

    problems = []
    for name, (a, b) in pairs.items():
        problems += compare(name, a, b)

    if problems:
        print("openapi.yaml and program.schema.json disagree:")
        for p in problems:
            print(f"  {p}")
        return 1
    print("Program, Series and Event agree between openapi.yaml and program.schema.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
