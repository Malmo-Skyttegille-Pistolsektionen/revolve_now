"""Print projects: generated/relay_box_<rev>-{base,lid,logo}.stl -> generated/relay_box_<rev>.3mf.

Base and lid on one plate, the lid upside down; each on its own plate when they do not fit one. The logo is a part of the lid on filament 2,
so it prints in whatever colour slot 2 holds; as the lid prints face down it is the first
three layers. Bambu Studio's CLI writes the project from the presets (via the cad-tools
bambu-3mf script) and the logo object is then folded into the lid object, the way
hardware/enclosure/src/enclosure.py declares its parts.
"""
import glob
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

GENERATED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "generated")
PRINTER, PROCESS, FILAMENT = "Bambu Lab P2S 0.4 nozzle", "0.20mm Standard @BBL P2S", "Bambu PLA Basic @BBL P2S"
SETS = ["enable_support=0", "wall_loops=3"]
LOGO_COLOUR = "#161616"
GAP = 10.0
BED = 256.0   # P2S

# The plugin script runs main() on import; take its functions without that.
_plugin = sorted(glob.glob(os.path.expanduser(
    "~/.claude/plugins/cache/jimisola-plugins/cad-tools/*/skills/bambu-3mf/scripts/bambu_3mf.py")))[-1]
bambu = {"__name__": "bambu_3mf"}
exec(open(_plugin).read().rsplit("\nmain()", 1)[0], bambu)


def load(path):
    data = open(path, "rb").read()
    n = struct.unpack("<I", data[80:84])[0]
    return [struct.unpack("<12f", data[84 + i * 50:132 + i * 50]) for i in range(n)]


def save(path, tris, fn):
    with open(path, "wb") as f:
        f.write(b"\0" * 80 + struct.pack("<I", len(tris)))
        for t in tris:
            a, b, c = (fn(*t[3 + 3 * k:6 + 3 * k]) for k in range(3))
            u, w = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
            f.write(struct.pack("<12fH", *n, *a, *b, *c, 0))


def bounds(tris):
    pts = [t[3 + 3 * k:6 + 3 * k] for t in tris for k in range(3)]
    return [min(p[a] for p in pts) for a in range(3)], [max(p[a] for p in pts) for a in range(3)]


def meshes(rev, tmp):
    """Base as modelled; lid and logo turned over together (180 deg about X) and set behind it.
    Returns the mesh paths and whether both fit one plate; if not, Bambu's arrange splits them over two.
    The logo rides with the lid either way: once folded in, it is placed by the lid's transform."""
    base, lid, logo = (load(os.path.join(GENERATED, f"relay_box_{rev}-{s}.stl")) for s in ("base", "lid", "logo"))
    (bx0, by0, bz0), (_, by1, _) = bounds(base)
    (lx0, ly0, _), (_, ly1, lz1) = bounds(lid)
    paths = [os.path.join(tmp, f"{s}.stl") for s in ("base", "lid", "logo")]
    bx1 = bounds(base)[1][0]
    ox, oy = (BED - (bx1 - bx0)) / 2, (BED - (by1 - by0) - GAP - (ly1 - ly0)) / 2
    one_plate = oy >= 0
    if not one_plate:
        oy = (BED - (by1 - by0)) / 2
    if min(ox, oy) < 0:
        sys.exit(f"{rev}: the base does not fit a {BED:.0f} mm plate")
    save(paths[0], base, lambda x, y, z: (x - bx0 + ox, y - by0 + oy, z - bz0))
    lid_y = oy + (by1 - by0) + GAP if one_plate else (BED - (ly1 - ly0)) / 2
    flip = lambda x, y, z: (x - lx0 + ox, ly1 - y + lid_y, lz1 - z)
    save(paths[1], lid, flip)
    save(paths[2], logo, flip)
    return paths, one_plate


def two_filaments(tmp):
    """Flattened preset JSONs: machine, process, and the filament twice, slot 2 in the logo colour."""
    paths = {}
    for kind, name, sets in (("machine", PRINTER, []), ("process", PROCESS, SETS), ("filament", FILAMENT, [])):
        paths[kind] = os.path.join(tmp, kind + ".json")
        json.dump(bambu["apply_overrides"](bambu["resolve"](kind, name), sets), open(paths[kind], "w"))
    logo = bambu["resolve"]("filament", FILAMENT)
    logo["filament_colour"] = [LOGO_COLOUR]
    paths["logo"] = os.path.join(tmp, "logo.json")
    json.dump(logo, open(paths["logo"], "w"))
    return paths


def fold_logo_into_lid(path):
    """Move the logo object's component and part into the lid object, on filament 2."""
    z = zipfile.ZipFile(path)
    items = {i: z.read(i) for i in z.namelist()}
    z.close()
    model = items["3D/3dmodel.model"].decode()
    cfg = items["Metadata/model_settings.config"].decode()

    objs = {m.group(2): m.group(1) for m in re.finditer(r'<object id="(\d+)">\s*<metadata key="name" value="(\w+)\.stl"/>', cfg)}
    lid, logo = objs["lid"], objs["logo"]
    obj_re = lambda i: re.compile(r'<object id="%s"[^>]*>.*?</object>\n?' % i, re.S)
    comp = re.search(r"<component .*?/>", obj_re(logo).search(model).group(0)).group(0)
    model = obj_re(logo).sub("", model, count=1)
    model = re.sub(r'(<object id="%s"[^>]*>.*?)(\s*</components>)' % lid, lambda m: m.group(1) + "\n    " + comp + m.group(2),
                   model, count=1, flags=re.S)
    model = re.sub(r'\s*<item objectid="%s"[^>]*/>' % logo, "", model)

    part = re.search(r"<part .*?</part>", obj_re(logo).search(cfg).group(0), re.S).group(0)
    part = re.sub(r'(<part [^>]*>)', r'\1\n      <metadata key="extruder" value="2"/>', part, count=1)
    cfg = obj_re(logo).sub("", cfg, count=1)
    cfg = re.sub(r'(<object id="%s">.*?</part>)' % lid, lambda m: m.group(1) + "\n    " + part, cfg, count=1, flags=re.S)
    cfg = re.sub(r'\s*<model_instance>\s*<metadata key="object_id" value="%s"/>.*?</model_instance>' % logo, "", cfg, flags=re.S)

    items["3D/3dmodel.model"], items["Metadata/model_settings.config"] = model.encode(), cfg.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in items.items():
            out.writestr(name, data)


def export(rev):
    tmp = tempfile.mkdtemp(prefix=f"relay_box_{rev}-")
    stls, one_plate = meshes(rev, tmp)
    p = two_filaments(tmp)
    out = os.path.abspath(os.path.join(GENERATED, f"relay_box_{rev}.3mf"))
    cmd = [bambu["find_bambu"](None), "--load-settings", f"{p['machine']};{p['process']}",
           "--load-filaments", f"{p['filament']};{p['logo']}", "--load-filament-ids", "1,1,2",
           "--orient", "0", "--arrange", "0" if one_plate else "1", "--export-3mf", out] + stls
    r = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        sys.exit(f"FAILED {out}\n{(r.stdout + r.stderr)[-2000:]}")
    fold_logo_into_lid(out)
    bambu["record_changes"](out, bambu["changed_keys"]("process", PROCESS, SETS), [])
    cfg, bad = bambu["check"](out, dict(s.partition("=")[::2] for s in SETS))
    if bad:
        sys.exit(f"{out}: NOT APPLIED {bad}")
    print(f"wrote {out}  [{cfg['printer_settings_id']} | {cfg['print_settings_id']} | {cfg['filament_settings_id']}]")


for rev in sys.argv[1:] or ["rev1a", "rev2"]:
    export(rev)
