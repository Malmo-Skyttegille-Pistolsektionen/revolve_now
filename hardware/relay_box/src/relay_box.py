"""Relay box: the controller board and an 8-channel relay board, with two Amphenol ecomate C016
control-line connectors. One box per controller revision (VARIANTS), each an App::Part in the one
document. Run in FreeCAD (GUI or freecadcmd); it rebuilds RelayBox, saves relay_box.FCStd beside
this file and writes the STL exports to ../generated/.

Frame: interior origin at the inner front-left corner, on top of the floor. X runs along the
connector wall to the controller, Y from the front wall to the back, Z up.
"""
import os

import FreeCAD as App
import MeshPart
import Part
from FreeCAD import Vector as V

SRC = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(SRC, "..", "generated")
DOC = "RelayBox"

WALL, FLOOR = 2.4, 2.4
WIRE_GAP = 36.0      # free space behind the connector bodies and the relay board, for the AC wiring
IZ = 40.0
MARGIN_Y = 4.0       # relay board to the front and back walls
STANDOFF_H, STANDOFF_R = 10.0, 3.5
INSERT_R = 2.0       # Ø4 hole for an M3 heat-set insert

# Amphenol C016 30C006 100 12 (6+PE male receptacle, solder): Ø22 cutout, 2 × M3 at 31 mm,
# flange 38 × 29, 18 in front of the panel, body Ø21.6 reaching A = 12 behind it.
CONN_FRONT, CONN_BEHIND, FLANGE_T = 18.0, 12.0, 4.0   # flange thickness not in the datasheet
CONN_Z = 20.0
# The mating plugs are 90° angled: rolled 45° they lie parallel, cable exits up and towards the
# front (the sketch on the issue). The plug's own exit relative to the key decides the final roll.
CONN_ROLL = 45.0
# Gebildet 10 mm 230 VAC metal indicator, one beside each connector on the outer side, at its height.
# Typical dimensions for the type, not measured: Ø10 thread, Ø14 head, nut 14 across flats.
LED = dict(hole_d=10.2, head_d=14.0, head_h=2.5, body_d=10.0, body_l=25.0, nut_d=16.2, nut_t=3.0)
LED_OFFSET = 30.0    # connector axis to LED axis, along the wall
# Angled plug stand-in, scaled off the C016 datasheet drawing (p. 9). Distances run outward from
# the panel; the coupling ring starts where the receptacle's flange collar ends.
ANGLED_PLUG = dict(start=7.5, ring=(30.0, 20.4), nut=(30.0, 4.5), body=(30.0, 10.5),
                   elbow=(36.8, 55.1, 11.2), gland=(26.0, 43.7, 41.7))

# 8-channel relay boards, long side along Y, outputs facing the connectors. `inset` is hole centre
# to board edge; `pins` the solder pins below the board.
RELAYS = {
    # DollaTek G3MB-202P SSR board, measured: holes "slightly more than 3", 1.3 from hole edge to board edge.
    "ssr": dict(w=55.0, d=105.0, h=21.6, inset=1.3 + 3.2 / 2, pins=3.2, label="SSR_8ch"),
    # ELEGOO 8-channel 5 V 10 A (Songle SRD-05VDC-SL-C): 137-138 × 56, Ø3.1 holes 132 × 50 apart, per
    # listings, not yet measured. Height over the relays and terminal blocks is typical, ditto the pins.
    "elegoo": dict(w=56.0, d=138.0, h=19.0, inset=3.0, pins=3.0, label="Relay_8ch"),
}
PCB_GAP = 8.0

# Controller boards, turned so the RJ45 edge (kicad y = 125) faces the right wall:
# X = kicad_y - 75, Y = kicad_x - kicad_x_min. Ø4.2 corner holes 4.5 in from each edge.
# Jack sizes are typical datasheet values, cross-checked against the KiCad 3D models of
# RJHSE538X (J3) and USB4105 (J8); J5, J7 and J9 have no model.
# `at` runs along the jack's wall from the board's corner. The halves are bridged (R1/R2), so only
# one USB-C may ever be powered: J8 is a knock-out, closed until pushed out from inside.
# `plug_w`: the widest plug body that has to pass the wall, USB-C overmold and RJ45 plug maxima.
JACK = {"usbc": dict(w=9.0, h=3.3, depth=9.0, cut_w=13.0, cut_h=7.0, plug_w=12.35, label="USB-C"),
        "rj45": dict(w=16.0, h=13.5, depth=14.0, cut_w=17.0, cut_h=14.5, plug_w=11.68, label="RJ45")}
# `overhang` is each jack's courtyard past the board edge; the right wall sits on the farthest
# one, so the jack faces end just behind it.
VARIANTS = {
    # hardware/controller/revolvenow_controller.kicad_pcb, rev 2: 95 × 50, all five jacks on the RJ45 edge.
    # pcb_y None: centred.
    "rev2": dict(relay="elegoo", pcb_y=None, pcb_d=95.0, overhang=dict(usbc=2.0, rj45=4.0), jacks=[
        ("J7", "usbc", "right", 15.0, False), ("J3", "rj45", "right", 29.25, False),
        ("J9", "rj45", "right", 47.5, False), ("J5", "rj45", "right", 65.75, False),
        ("J8", "usbc", "right", 80.0, True)]),
}
KNOCKOUT = dict(skin=0.8, groove=0.6, web=0.4)
MIN_WEB = 1.2     # wall left between neighbouring cut-outs; an RJ45 cut gives way to a USB-C one
PLUG_CLEAR = 0.5  # least room left beside a plug once a cut-out has given way

# Labels engraved into the outside of the walls.
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
TEXT_SIZE, TEXT_GAP, ENGRAVE = 4.0, 1.5, 0.5
# Outside names: the controller's silkscreen groups (J3 is "1-2", J5 "3-4"), J9 the manual remote
# control (no silkscreen; "REMOTE" is wider than its opening), the USB-Cs numbered J7 #1 and J8 #2,
# and the 230 V connectors in the same order from the front.
NAMES = {"J3": "1-2", "J5": "3-4", "J9": "REM", "J7": "#1", "J8": "#2"}
CONN_NAMES = ("1-2", "3-4")
LABEL_PITCH = 17.0   # closer than this, neighbouring jacks of one kind share their type label

BOSS_R, BOSS_H = 4.0, 12.0   # lid screw bosses hang from the top, a 45° cone below each

LOGO_SVG = os.path.join(SRC, "..", "..", "..", "webapp", "public", "revolve-now-logo.svg")
LOGO_WIDTH, LOGO_DEPTH = 110.0, 0.6
FRAME_PAD, FRAME_STROKE, FRAME_R = 4.0, 1.2, 4.0   # as hardware/enclosure

Z_TOP = IZ + WALL
PCB_T = 1.6
PCB_TOP = STANDOFF_H + PCB_T


def box(lx, ly, lz, pos):
    return Part.makeBox(lx, ly, lz, V(*pos))


def cyl(r, h, pos, d=(0, 0, 1)):
    return Part.makeCylinder(r, h, V(*pos), V(*d))


def rounded_box(x0, y0, x1, y1, z0, z1, r):
    b = box(x1 - x0, y1 - y0, z1 - z0, (x0, y0, z0))
    return b.makeFillet(r, [e for e in b.Edges
                            if abs(e.Vertexes[0].Point.z - e.Vertexes[1].Point.z) > 1e-6])


def rolled(shape, cy):
    """`shape`, drawn for a connector with its flange holes along Y, rolled CONN_ROLL about its axis."""
    return shape.rotate(V(0, cy, CONN_Z), V(1, 0, 0), CONN_ROLL)


def layout(v):
    """The box follows its relay board, so the interior and everything placed from it is set per variant."""
    global SSR, PCB, IX, IY, CONN_Y, CORNERS, WALLS
    r = RELAYS[v["relay"]]
    SSR = dict(r, x=CONN_BEHIND - WALL + WIRE_GAP, y=MARGIN_Y)
    IY = r["d"] + 2 * MARGIN_Y
    PCB = dict(x=SSR["x"] + SSR["w"] + PCB_GAP, w=50.0, t=PCB_T, inset=4.5)
    IX = PCB["x"] + PCB["w"] + max(v["overhang"][kind] for _, kind, wall, _, _ in v["jacks"] if wall == "right")
    if v["pcb_y"] is None:
        v["pcb_y"] = (IY - v["pcb_d"]) / 2
    CONN_Y = (IY / 2 - 26.5, IY / 2 + 26.5)
    CORNERS = [(1.5, 1.5), (IX - 1.5, 1.5), (1.5, IY - 1.5), (IX - 1.5, IY - 1.5)]
    # Each wall as (outer point, along, up, outward normal), so text reads correctly from outside.
    WALLS = {"left": (V(-WALL, 0, 0), V(0, -1, 0), V(0, 0, 1), V(-1, 0, 0)),
             "right": (V(IX + WALL, 0, 0), V(0, 1, 0), V(0, 0, 1), V(1, 0, 0))}


def on_wall(shape, wall, s, z):
    """`shape` drawn in a local frame (x along the wall, y up, z outward from the outer face),
    placed with its origin at box coordinate `s` along `wall`, height `z`, on the outer face."""
    o, u, v, n = WALLS[wall]
    base = o + V(0, s, z)
    m = App.Matrix(u.x, v.x, n.x, base.x, u.y, v.y, n.y, base.y, u.z, v.z, n.z, base.z, 0, 0, 0, 1)
    return shape.transformGeometry(m)


def wall_cut(wall, s, z0, w, h, t0=-1.0, t1=WALL + 1.0):
    """A w × h cut centred on `s`, from depth t0 to t1 measured inward from the outer face."""
    return on_wall(box(w, h, t1 - t0, (-w / 2, 0, -t1)), wall, s, z0)


def text(lines, wall, s, z):
    """Engraving cutter: `lines`, centred on `s`, bottom line's baseline at height `z`."""
    faces = []
    for i, line in enumerate(reversed(lines)):
        chars = Part.makeWireString(line, FONT, TEXT_SIZE)
        f = Part.makeCompound([Part.makeFace(ws, "Part::FaceMakerBullseye") for ws in chars if ws])
        f.translate(V(-f.BoundBox.Center.x, i * (TEXT_SIZE + TEXT_GAP), 0))
        faces.append(f)
    flat = Part.makeCompound(faces)
    flat.translate(V(0, 0, 0.5))
    return on_wall(flat.extrude(V(0, 0, -ENGRAVE - 0.5)), wall, s, z)


def standoffs(x, y, w, d, inset):
    s = []
    for px in (x + inset, x + w - inset):
        for py in (y + inset, y + d - inset):
            s.append(cyl(STANDOFF_R, STANDOFF_H, (px, py, 0)).cut(cyl(INSERT_R, STANDOFF_H, (px, py, 1.0))))
    return s


def jack_frame(v, at):
    """Box coordinate of a jack's centre along the right wall."""
    return v["pcb_y"] + at


def jack_cuts(v):
    """Each jack's wall cut-out as its extent along the wall (lo, hi) and in height (z0, h)."""
    cuts = []
    for ref, kind, wall, at, knockout in v["jacks"]:
        j = JACK[kind]
        s = jack_frame(v, at)
        # RJ45: from just below the board top; USB-C: centred on the receptacle, for the plug overmold
        z0 = PCB_TOP - 0.5 if kind == "rj45" else PCB_TOP + j["h"] / 2 - j["cut_h"] / 2
        cuts.append(dict(ref=ref, kind=kind, wall=wall, s=s, z0=z0, h=j["cut_h"], knockout=knockout,
                         lo=s - j["cut_w"] / 2, hi=s + j["cut_w"] / 2))
    for wall in {c["wall"] for c in cuts}:
        row = sorted((c for c in cuts if c["wall"] == wall), key=lambda c: c["s"])
        for a, b in zip(row, row[1:]):
            if b["lo"] - a["hi"] >= MIN_WEB or a["z0"] + a["h"] <= b["z0"] or b["z0"] + b["h"] <= a["z0"]:
                continue
            if a["kind"] == "rj45" and b["kind"] == "usbc":
                a["hi"], a["trimmed"] = b["lo"] - MIN_WEB, True
            elif a["kind"] == "usbc" and b["kind"] == "rj45":
                b["lo"], b["trimmed"] = a["hi"] + MIN_WEB, True
            else:
                raise RuntimeError(f"{a['ref']} and {b['ref']}: cut-outs closer than {MIN_WEB} mm")
    for c in (c for c in cuts if c.get("trimmed")):
        if min(c["s"] - c["lo"], c["hi"] - c["s"]) < JACK[c["kind"]]["plug_w"] / 2 + PLUG_CLEAR:
            raise RuntimeError(f"{c['ref']}: cut-out too narrow for the plug")
    return cuts


def build_box(v):
    shell = box(IX + 2 * WALL, IY + 2 * WALL, IZ + FLOOR, (-WALL, -WALL, -FLOOR)).cut(box(IX, IY, IZ + 1, (0, 0, 0)))
    cavity = box(IX, IY, IZ, (0, 0, 0))
    for cx, cy in CORNERS:
        boss = cyl(BOSS_R, BOSS_H, (cx, cy, IZ - BOSS_H)).fuse(
            Part.makeCone(0, BOSS_R, BOSS_R, V(cx, cy, IZ - BOSS_H - BOSS_R)))
        shell = shell.fuse(boss.common(cavity)).cut(cyl(INSERT_R, 8, (cx, cy, IZ - 8)))
    for s in standoffs(SSR["x"], SSR["y"], SSR["w"], SSR["d"], SSR["inset"]) + \
            standoffs(PCB["x"], v["pcb_y"], PCB["w"], v["pcb_d"], PCB["inset"]):
        shell = shell.fuse(s)

    cuts = []
    for cy in CONN_Y:
        cuts.append(cyl(11.1, WALL + 2, (-WALL - 1, cy, CONN_Z), (1, 0, 0)))
        cuts += [rolled(cyl(1.6, WALL + 2, (-WALL - 1, cy + dy, CONN_Z), (1, 0, 0)), cy) for dy in (-15.5, 15.5)]
    cuts.append(text(["230 V"], "left", IY / 2, CONN_Z - TEXT_SIZE / 2))
    for ly in led_y():
        cuts.append(cyl(LED["hole_d"] / 2, WALL + 2, (-WALL - 1, ly, CONN_Z), (1, 0, 0)))
    for cy, name in zip(CONN_Y, CONN_NAMES):
        cuts.append(text([name], "left", cy, 0.5))   # under the flange, which reaches down to Z 5.5

    label_z = {}
    for c in jack_cuts(v):
        s, w, h, z0 = (c["lo"] + c["hi"]) / 2, c["hi"] - c["lo"], c["h"], c["z0"]
        if c["knockout"]:
            k, g = KNOCKOUT, KNOCKOUT["groove"]
            cuts.append(wall_cut(c["wall"], s, z0, w, h, t0=k["skin"]))
            cuts.append(wall_cut(c["wall"], s, z0, w, h, t0=k["web"]).cut(
                wall_cut(c["wall"], s, z0 + g, w - 2 * g, h - 2 * g)))
        else:
            cuts.append(wall_cut(c["wall"], s, z0, w, h))
        label_z[c["wall"]] = max(label_z.get(c["wall"], 0.0), z0 + h + 2.0)
    # Each reference under its jack; the type above, shared by neighbours of one kind too close for two.
    for wall in label_z:
        row = sorted((jack_frame(v, at), kind, ref) for ref, kind, w, at, _ in v["jacks"] if w == wall)
        groups = []
        for js, kind, ref in row:
            if groups and groups[-1][0] == kind and js - groups[-1][1][-1] < LABEL_PITCH:
                groups[-1][1].append(js)
            else:
                groups.append((kind, [js]))
            cuts.append(text([NAMES.get(ref, ref)], wall, js, label_z[wall]))
        for kind, centres in groups:
            cuts.append(text([JACK[kind]["label"]], wall, sum(centres) / len(centres),
                             label_z[wall] + TEXT_SIZE + TEXT_GAP))
    return shell.cut(Part.makeCompound(cuts)).removeSplitter()


def logo_faces():
    import importSVG

    tmp = App.newDocument("logo_import")
    gui_up, App.GuiUp = App.GuiUp, False   # else importSVG asks for a DPI in a modal dialog; we rescale anyway
    try:
        importSVG.insert(os.path.normpath(LOGO_SVG), tmp.Name)
    finally:
        App.GuiUp = gui_up
    faces = [f.copy() for o in tmp.Objects if hasattr(o, "Shape") for f in o.Shape.Faces]
    App.closeDocument(tmp.Name)
    logo = faces[0].fuse(faces[1:]).removeSplitter()
    m = App.Matrix()
    k = LOGO_WIDTH / logo.BoundBox.XLength
    m.scale(k, k, k)
    logo = logo.transformGeometry(m)
    bb = logo.BoundBox
    logo.translate(V(IX / 2 - bb.Center.x, IY / 2 - bb.Center.y, -bb.ZMin))
    bb = logo.BoundBox
    outer = rounded_box(bb.XMin - FRAME_PAD - FRAME_STROKE, bb.YMin - FRAME_PAD - FRAME_STROKE,
                        bb.XMax + FRAME_PAD + FRAME_STROKE, bb.YMax + FRAME_PAD + FRAME_STROKE, 0, 1, FRAME_R)
    inner = rounded_box(bb.XMin - FRAME_PAD, bb.YMin - FRAME_PAD, bb.XMax + FRAME_PAD, bb.YMax + FRAME_PAD,
                        -1, 2, FRAME_R - FRAME_STROKE)
    frame = [f for f in outer.cut(inner).Faces if abs(f.normalAt(0, 0).z + 1) < 1e-6]
    flat = logo.fuse(frame).removeSplitter()
    flat.translate(V(0, 0, Z_TOP - LOGO_DEPTH))
    return flat


def build_lid(logo_flat):
    lid = box(IX + 2 * WALL, IY + 2 * WALL, WALL, (-WALL, -WALL, IZ))
    lip = box(IX - 0.6, IY - 0.6, 3.0, (0.3, 0.3, IZ - 3.0)).cut(box(IX - 4.6, IY - 4.6, 3.0, (2.3, 2.3, IZ - 3.0)))
    for cx, cy in CORNERS:
        lip = lip.cut(cyl(BOSS_R + 0.4, 3.1, (cx, cy, IZ - 3.05)))
    lid = lid.fuse(lip)
    for cx, cy in CORNERS:
        lid = lid.cut(cyl(1.7, WALL + 2, (cx, cy, IZ - 0.5)))
        lid = lid.cut(Part.makeCone(1.7, 3.4, 1.7, V(cx, cy, Z_TOP - 1.7)))   # M3 countersink
    return lid.cut(logo_flat.extrude(V(0, 0, LOGO_DEPTH + 1.0))).removeSplitter()


def stand_ins(v):
    """Boards and connectors as blocks, for the fit check and the renders."""
    pcb_y = v["pcb_y"]
    parts = {
        SSR["label"]: box(SSR["w"], SSR["d"], 1.6, (SSR["x"], SSR["y"], STANDOFF_H)).fuse(
            box(SSR["w"] - 2, SSR["d"] - 2, SSR["h"] - 1.6, (SSR["x"] + 1, SSR["y"] + 1, STANDOFF_H + 1.6))),
        "Controller_PCB": box(PCB["w"], v["pcb_d"], PCB["t"], (PCB["x"], pcb_y, STANDOFF_H)),
    }
    for ref, kind, wall, at, _ in v["jacks"]:
        j = JACK[kind]
        s = jack_frame(v, at)
        edge = PCB["x"] + PCB["w"] + v["overhang"][kind]
        parts[f"{ref}_{kind}"] = box(j["depth"], j["w"], j["h"], (edge - j["depth"], s - j["w"] / 2, PCB_TOP))
    for i, cy in enumerate(CONN_Y, 1):
        x_flange = -WALL - FLANGE_T
        flange = cyl(14.5, FLANGE_T, (x_flange, cy, CONN_Z), (1, 0, 0))
        for dy in (-15.5, 15.5):   # ears: R3.5 round the Ø3.6 holes, tangent to the Ø29 body
            ear = cyl(3.5, FLANGE_T, (x_flange, cy + dy, CONN_Z), (1, 0, 0)).fuse(
                box(FLANGE_T, abs(dy), 7.0, (x_flange, min(cy, cy + dy), CONN_Z - 3.5)))
            flange = flange.fuse(ear).cut(cyl(1.8, FLANGE_T, (x_flange, cy + dy, CONN_Z), (1, 0, 0)))
        collar = cyl(13.9, 3.5, (-WALL - 7.5, cy, CONN_Z), (1, 0, 0))
        thread = cyl(12.0, 6.5, (-WALL - 14.0, cy, CONN_Z), (1, 0, 0))
        insert = cyl(9.0, CONN_FRONT - 14.0, (-WALL - CONN_FRONT, cy, CONN_Z), (1, 0, 0))
        body = cyl(10.8, CONN_BEHIND - WALL, (0, cy, CONN_Z), (1, 0, 0))
        parts[f"Conn_{i}"] = rolled(flange.fuse([collar, thread, insert, body]), cy)

        p = ANGLED_PLUG

        def along(u0, length, d):   # a cylinder on the plug axis, u measured outward from the panel
            return cyl(d / 2, length, (-WALL - u0 - length, cy, CONN_Z), (1, 0, 0))
        u = p["start"]
        plug = along(u, p["ring"][1], p["ring"][0])
        u += p["ring"][1] + 1.0
        plug = plug.fuse(along(u, p["nut"][1], p["nut"][0]))
        u += p["nut"][1]
        plug = plug.fuse(along(u, p["body"][1], p["body"][0]))
        e0, e1, e_top = p["elbow"]
        g_d, g_u, g_reach = p["gland"]
        plug = plug.fuse(box(e1 - e0, g_d, e_top + g_reach - 10.0,
                             (-WALL - p["start"] - e1, cy - g_d / 2, CONN_Z - g_reach + 10.0)))
        plug = plug.fuse(cyl(g_d / 2, 10.0, (-WALL - p["start"] - g_u, cy, CONN_Z - g_reach), (0, 0, 1)))
        plug = plug.mirror(V(0, cy, CONN_Z), V(0, 0, 1))   # cable exits upward before the roll
        parts[f"Plug_{i}"] = rolled(plug, cy)
    for i, ly in enumerate(led_y(), 1):
        head = cyl(LED["head_d"] / 2, LED["head_h"], (-WALL - LED["head_h"], ly, CONN_Z), (1, 0, 0))
        body = cyl(LED["body_d"] / 2, LED["body_l"], (-WALL, ly, CONN_Z), (1, 0, 0))
        nut = cyl(LED["nut_d"] / 2, LED["nut_t"], (0, ly, CONN_Z), (1, 0, 0))
        parts[f"LED_{i}"] = head.fuse([body, nut])
    return parts


def led_y():
    return (CONN_Y[0] - LED_OFFSET, CONN_Y[1] + LED_OFFSET)


COLOURS = {"LED_1": (0.8, 0.1, 0.1), "LED_2": (0.8, 0.1, 0.1), "SSR_8ch": (0.1, 0.1, 0.1), "Relay_8ch": (0.1, 0.25, 0.6), "Controller_PCB": (0.1, 0.3, 0.8)}


REV_OFFSET = 200.0   # rev containers side by side along Y in the one document


def label_of(part):
    ref, _, kind = part.partition("_")
    if kind in JACK:
        return f"{JACK[kind]['label']} {NAMES[ref]} ({ref})" if ref in NAMES else f"{JACK[kind]['label']} {ref}"
    if part.startswith(("Conn_", "Plug_", "LED_")):
        return f"{part.split('_')[0]} 230 V {CONN_NAMES[int(part[-1]) - 1]}"
    return part


def build(doc, i, rev):
    """Rev `rev` as an App::Part container in `doc`, checked, plus its STL exports."""
    v = VARIANTS[rev]
    layout(v)
    if STANDOFF_H - SSR["pins"] < 6.0:
        raise RuntimeError(f"{rev}: relay board solder pins too close to the floor")
    logo_flat = logo_faces()
    App.setActiveDocument(doc.Name)
    container = doc.addObject("App::Part", f"Box_{rev}")
    container.Label = f"Relay box {rev}"
    container.Placement.Base = V(0, i * REV_OFFSET, 0)

    def add(name, shp, label):
        o = doc.addObject("Part::Feature", f"{name}_{rev}")
        o.Shape, o.Label = shp, f"{label} [{rev}]"
        return o

    shapes = {"Enclosure": build_box(v), "Lid": build_lid(logo_flat),
              "Logo": logo_flat.extrude(V(0, 0, LOGO_DEPTH))}
    for part, shp in shapes.items():
        if not shp.isValid() or (part != "Logo" and len(shp.Solids) != 1):  # the logo is one solid per letter
            raise RuntimeError(f"{rev} {part}: not a valid solid")
        container.addObject(add(part, shp, part))

    grp = doc.addObject("App::DocumentObjectGroup", f"Placeholders_{rev}")
    grp.Label = f"Placeholders [{rev}]"
    container.addObject(grp)
    ins = stand_ins(v)
    for led in (k for k in ins if k.startswith("LED_")):
        for other in (k for k in ins if k.startswith(("Conn_", "Plug_"))):
            if ins[led].common(ins[other]).Volume > 1e-3:
                raise RuntimeError(f"{rev}: {led} intersects {other}")
    for part, shp in ins.items():
        for against in ("Enclosure", "Lid"):
            if shp.common(shapes[against]).Volume > 1e-3:
                raise RuntimeError(f"{rev}: {part} intersects {against}")
        o = add(part, shp, label_of(part))
        grp.addObject(o)
        if App.GuiUp:
            o.ViewObject.ShapeColor = COLOURS.get(part, (0.75, 0.75, 0.75) if "usbc" in part else (0.08, 0.08, 0.08))

    if App.GuiUp:
        enc = doc.getObject(f"Enclosure_{rev}").ViewObject
        enc.ShapeColor, enc.Transparency = (0.25, 0.26, 0.28), 50
        doc.getObject(f"Lid_{rev}").ViewObject.Visibility = False
        doc.getObject(f"Logo_{rev}").ViewObject.Visibility = False

    os.makedirs(GENERATED, exist_ok=True)
    for part, stem in (("Enclosure", "base"), ("Lid", "lid"), ("Logo", "logo")):
        mesh = MeshPart.meshFromShape(Shape=shapes[part], LinearDeflection=0.01, AngularDeflection=0.1)
        if part != "Logo" and (not mesh.isSolid() or mesh.hasNonManifolds()):
            raise RuntimeError(f"{rev} {part}: mesh is not a closed manifold")
        mesh.write(os.path.join(GENERATED, f"relay_box_{rev}-{stem}.stl"))
    print(f"{rev}: outside {IX + 2 * WALL:.1f} x {IY + 2 * WALL:.1f} x {IZ + FLOOR + WALL:.1f} mm, "
          f"wire gap {SSR['x'] - (CONN_BEHIND - WALL):.1f} mm, {v['relay']} relay board")


def main():
    if DOC in App.listDocuments():
        App.closeDocument(DOC)
    doc = App.newDocument(DOC)
    for i, rev in enumerate(VARIANTS):
        build(doc, i, rev)
    doc.recompute()
    doc.saveAs(os.path.join(SRC, "relay_box.FCStd"))


main()
