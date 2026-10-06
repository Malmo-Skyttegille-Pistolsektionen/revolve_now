# Enclosure for the Revolve Now rev 1 board: a base tray and a lid, built from
# the KiCad layout (hardware/revolvenow_hardware.kicad_pcb, PR #436).
#
# Regenerate with FreeCAD 1.1 (see README.md):
#   freecadcmd hardware/enclosure/src/enclosure.py
# It saves enclosure.FCStd beside itself and writes the STEP, STL and 3MF
# exports to ../generated/.
#
# Frame: KiCad (x, y) -> X = x - 100, Y = 150 - y. The board is X 0..100,
# Y 0..100. Y = 0 is the connector edge (J1, J2, J7, U11), Y = 100 the edge the
# ESP32 antenna overhangs, X = 100 the USB-C edge.
#
# Positions are read off the KiCad file. Connector heights and face widths are
# not in it (no 3D models), so those are datasheet-typical; see README.md.

import math
import os
import zipfile
import FreeCAD as App
import Part
import MeshPart
from FreeCAD import Vector as V

SRC = os.path.dirname(os.path.abspath(__file__))           # enclosure.py, enclosure.FCStd
GENERATED = os.path.join(os.path.dirname(SRC), "generated")     # STEP, STL and 3MF exports

# --- Board (from KiCad) -------------------------------------------------------
PCB_W, PCB_D, PCB_T = 100.0, 100.0, 1.6
HOLES = [(5.5, 5.5), (94.5, 5.5), (5.5, 94.5), (94.5, 94.5)]  # 4.7 mm edge cuts
HOLE_D = 4.7
# ESP32-S3-WROOM-1 body: KiCad x 129.2..147.2, y 44.75..70.25 -> overhangs Y=100 by 5.25
MODULE = dict(x0=29.2, x1=47.2, y0=79.75, y1=105.25, h=3.1)

# --- Enclosure parameters -----------------------------------------------------
WALL = 2.0          # side walls
FLOOR = 2.0         # base floor
LID_T = 2.0         # lid top
GAP = 0.5           # PCB edge to inner wall
ANTENNA_CUTOUT = True  # module pokes out through a slot in the back wall, as on the bare board
ANT_GAP = 1.0       # with ANTENNA_CUTOUT off: module tip to the inner wall of a deeper back bay
R_OUT = 3.0         # outer vertical corner radius
STANDOFF_H = 5.0    # floor to PCB underside (THT leads stick out ~2-3 mm)
HEADROOM = 16.0     # PCB top to lid underside; tallest part is an RJ45 (~13.5)
BOSS_D = 8.0        # standoff / lid-post diameter at the board (clears J4's pads by 0.5 mm)

# Fastening: M3x16 socket-head screws (ISO 4762) up through the base into hex nuts
# captive in the lid posts, so the lid top stays unbroken. No heat-set inserts.
SCREW_D = 3.4       # M3 clearance
HEAD_D, HEAD_H = 6.0, 3.2       # counterbore in the base underside; the head sits flush
FOOT_D = 10.0       # standoff widened round the counterbore, below where THT leads reach
NUT_AF, NUT_H = 5.8, 2.7        # M3 nut (5.5 AF, 2.4 thick) plus clearance; slid in from the side
NUT_Z = 5.0         # nut slot bottom above the PCB top; the post is solid below it
POST_STEP = 4.5     # above this height over the PCB the lid post widens to POST_D (J4 is 3.3 tall)
POST_D = 9.6        # leaves 1.45 mm of wall round the nut's corners
LAYER = 0.2         # print layer height, for the bridging steps over the counterbore

# The logo and its frame are inlaid in the lid top, read from the web app's copy so the box
# follows any change to it. It reads upright with the connector edge facing you.
LOGO_SVG = os.path.join(SRC, "..", "..", "..", "webapp", "public", "revolve-now-logo.svg")
LOGO_WIDTH = 80.0   # thinnest stroke is then ~0.67 mm, fine for a 0.4 mm nozzle
LOGO_DEPTH = 0.6    # into the 2 mm lid top; prints face-down on the bed
FRAME_PAD, FRAME_STROKE, FRAME_R = 4.0, 1.2, 4.0   # rounded-rectangle frame round the logo

# Openings. side: front (Y=0), right (X=100), left (X=0). centre is along the
# side in board coords; z is relative to PCB top. Widths/heights include clearance:
# 1 mm or more on every side of the connector body.
OPENINGS = [
    # ref, side, centre, kind, width, height (rect: bottom at PCB top) / dia + axis z (round)
    dict(ref="J1 RJ45 Power/Turn 0-1", side="front", c=22.5,   kind="rect", w=18.8, h=16.0),
    dict(ref="J2 RJ45 Power/Turn 2-3", side="front", c=42.5,   kind="rect", w=18.8, h=16.0),
    dict(ref="J7 audio PJ-320A",       side="front", c=60.5,   kind="round", d=9.0, z=2.6),
    dict(ref="U11 Ethernet MagJack",   side="front", c=78.215, kind="rect", w=19.0, h=16.3),
    dict(ref="J4 USB-C",               side="right", c=84.71,  kind="slot", w=14.5, h=9.0, z=1.63, r=2.5),
]
# J3 (trigger RJ45, left edge, centre Y=53.44) is not fitted on rev 1; flip on if needed.
TRIGGER_OPENING = False
if TRIGGER_OPENING:
    OPENINGS.append(dict(ref="J3 RJ45 Trigger", side="left", c=53.44, kind="rect", w=16.8, h=14.0))

# Fit-check stand-ins (approximate bodies, not exported): ref, x0, x1, y0, y1, h above PCB
FIT = [
    ("J1", 14.5, 30.5, -2.5, 11.5, 13.5),
    ("J2", 34.5, 50.5, -2.5, 11.5, 13.5),
    ("U11", 70.1, 86.3, -2.9, 19.7, 13.6),
    ("J7", 57.5, 63.5, -0.4, 12.35, 5.0),  # body only; the barrel sits in the round hole
    ("J4", 92.5, 101.5, 79.7, 89.7, 3.3),
]

# --- Derived ------------------------------------------------------------------
IN_X0, IN_X1 = -GAP, PCB_W + GAP
IN_Y0 = -GAP
IN_Y1 = PCB_D + GAP if ANTENNA_CUTOUT else max(PCB_D + GAP, MODULE["y1"] + ANT_GAP)
OUT_X0, OUT_X1 = IN_X0 - WALL, IN_X1 + WALL
OUT_Y0, OUT_Y1 = IN_Y0 - WALL, IN_Y1 + WALL
Z_PCB_BOT = FLOOR + STANDOFF_H
Z_PCB_TOP = Z_PCB_BOT + PCB_T          # base/lid split plane
Z_TOP = Z_PCB_TOP + HEADROOM + LID_T


if ANTENNA_CUTOUT:
    # starts 0.5 mm below the split so the overhang never rests on the base wall
    OPENINGS.append(dict(ref="U1 ESP32 antenna", side="back", c=(MODULE["x0"] + MODULE["x1"]) / 2,
                         kind="rect", w=MODULE["x1"] - MODULE["x0"] + 1.0, h=MODULE["h"] + 1.0, z0=-0.5))  # 0.5 mm all round


def rounded_box(x0, y0, x1, y1, z0, z1, r):
    box = Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))
    if r <= 0:
        return box
    vertical = [e for e in box.Edges
                if abs(e.Vertexes[0].Point.z - e.Vertexes[1].Point.z) > 1e-6]
    return box.makeFillet(r, vertical)


def checked(op, before, label):
    """Boolean guard: refuse results that are invalid or lost most of the volume."""
    res = op.removeSplitter()
    if not res.isValid() or len(res.Solids) != 1 or res.Volume < before * 0.5:
        raise RuntimeError(f"{label}: suspicious boolean (valid={res.isValid()}, "
                           f"solids={len(res.Solids)}, vol={res.Volume:.0f} vs {before:.0f})")
    return res


def opening_cutter(o):
    """A solid that removes one connector opening from whichever part it crosses."""
    t = WALL + 2.0  # through the wall only, 1 mm either side, so no cutter reaches a post
    if o["kind"] == "rect":
        z0 = Z_PCB_TOP + o.get("z0", -0.01)  # z0: bottom relative to the PCB top
        z1 = z0 + o["h"]
        a0, a1 = o["c"] - o["w"] / 2, o["c"] + o["w"] / 2
        if o["side"] == "front":
            return Part.makeBox(a1 - a0, t, z1 - z0, V(a0, OUT_Y0 - 1, z0))
        if o["side"] == "back":
            return Part.makeBox(a1 - a0, t, z1 - z0, V(a0, IN_Y1 - 1, z0))
        if o["side"] == "left":
            return Part.makeBox(t, a1 - a0, z1 - z0, V(OUT_X0 - 1, a0, z0))
        return Part.makeBox(t, a1 - a0, z1 - z0, V(IN_X1 - 1, a0, z0))
    zc = Z_PCB_TOP + o["z"]
    if o["kind"] == "round":
        # round hole; open downwards to the split plane so the lid drops over the jack
        r = o["d"] / 2
        cyl = Part.makeCylinder(r, t, V(o["c"], OUT_Y0 - 1, zc), V(0, 1, 0))
        drop = Part.makeBox(o["d"], t, zc - (Z_PCB_TOP - 0.01), V(o["c"] - r, OUT_Y0 - 1, Z_PCB_TOP - 0.01))
        below = Part.makeBox(o["d"], t, max(r - o["z"], 0) + 0.01, V(o["c"] - r, OUT_Y0 - 1, Z_PCB_TOP - max(r - o["z"], 0)))
        return cyl.fuse([drop, below]).removeSplitter()
    # slot: rounded rectangle through the right wall. Rotating about Y by 90 deg
    # sends local Z (extrusion) to +X and local X to -Z, so height goes in local X.
    plate = rounded_box(-o["h"] / 2, -o["w"] / 2, o["h"] / 2, o["w"] / 2, 0, t, o["r"])
    plate.Placement = App.Placement(V(IN_X1 - 1, o["c"], zc), App.Rotation(V(0, 1, 0), 90))
    return plate


def check_openings_clear_bosses():
    for o in OPENINGS:
        cut = opening_cutter(o)
        for (x, y) in HOLES:
            boss = Part.makeCylinder(max(BOSS_D, POST_D, FOOT_D) / 2, Z_TOP, V(x, y, 0))
            if cut.common(boss).Volume > 1e-6:
                raise RuntimeError(f"{o['ref']} opening would cut into the screw post at {x},{y}")


def build_base():
    shell = rounded_box(OUT_X0, OUT_Y0, OUT_X1, OUT_Y1, 0, Z_PCB_TOP, R_OUT)
    v = shell.Volume
    cavity = rounded_box(IN_X0, IN_Y0, IN_X1, IN_Y1, FLOOR, Z_PCB_TOP + 1, max(R_OUT - WALL, 0.5))
    base = checked(shell.cut(cavity), v * 0.2, "base cavity")
    for (x, y) in HOLES:
        boss = Part.makeCylinder(BOSS_D / 2, STANDOFF_H + 0.5, V(x, y, FLOOR - 0.5))
        foot = Part.makeCylinder(FOOT_D / 2, HEAD_H + 2 * LAYER + 1.0 - FLOOR + 0.5, V(x, y, FLOOR - 0.5))
        base = checked(base.fuse([boss, foot]), base.Volume, f"standoff {x},{y}")
        base = checked(base.cut(screw_bore(x, y)), base.Volume, f"screw bore {x},{y}")
    for o in OPENINGS:
        base = checked(base.cut(opening_cutter(o)), base.Volume, o["ref"])
    return base


def screw_bore(x, y):
    """Counterbore from below, then the clearance hole. The two one-layer steps between
    them let the printer bridge the counterbore ceiling instead of drooping into it."""
    cb = Part.makeCylinder(HEAD_D / 2, HEAD_H + 1, V(x, y, -1))
    step1 = Part.makeBox(SCREW_D, HEAD_D, LAYER, V(x - SCREW_D / 2, y - HEAD_D / 2, HEAD_H - 0.01))
    step2 = Part.makeBox(SCREW_D, SCREW_D, 2 * LAYER, V(x - SCREW_D / 2, y - SCREW_D / 2, HEAD_H - 0.01))
    bore = Part.makeCylinder(SCREW_D / 2, Z_PCB_BOT + 1, V(x, y, 0))
    return cb.fuse([step1, step2, bore]).removeSplitter()


def nut_slot(x, y):
    """Hex pocket round the screw axis, open towards the middle of the box to slide the nut in."""
    z0 = Z_PCB_TOP + NUT_Z
    r = NUT_AF / 3 ** 0.5  # circumradius
    pts = [V(x + r * math.cos(math.radians(60 * i)), y + r * math.sin(math.radians(60 * i)), z0)
           for i in range(7)]
    pocket = Part.Face(Part.makePolygon(pts)).extrude(V(0, 0, NUT_H))
    reach = POST_D / 2 + 1.0
    channel = Part.makeBox(reach, NUT_AF, NUT_H, V(x, y - NUT_AF / 2, z0))
    # turn the channel to point at the box centre; the hexagon's flats line up with it
    ang = math.degrees(math.atan2(PCB_D / 2 - y, PCB_W / 2 - x))
    channel.rotate(V(x, y, z0), V(0, 0, 1), ang)
    pocket.rotate(V(x, y, z0), V(0, 0, 1), ang)
    return pocket.fuse(channel).removeSplitter()


def logo_faces():
    """The logo inside its rounded-rectangle frame, as flat faces on the lid top, centred."""
    import importSVG  # Draft's importer; headless it assumes 96 dpi, and we rescale anyway

    tmp = App.newDocument("logo_import")
    importSVG.insert(os.path.normpath(LOGO_SVG), tmp.Name)
    faces = [f.copy() for o in tmp.Objects if hasattr(o, "Shape") for f in o.Shape.Faces]
    App.closeDocument(tmp.Name)
    logo = faces[0].fuse(faces[1:]).removeSplitter()  # even-odd islands arrive as separate faces
    m = App.Matrix()
    k = LOGO_WIDTH / logo.BoundBox.XLength
    m.scale(k, k, k)  # uniform: non-uniform scaling of a shape corrupts later booleans
    logo = logo.transformGeometry(m)
    bb = logo.BoundBox
    logo.translate(V((OUT_X0 + OUT_X1) / 2 - bb.Center.x, (OUT_Y0 + OUT_Y1) / 2 - bb.Center.y, -bb.ZMin))
    bb = logo.BoundBox
    outer = rounded_box(bb.XMin - FRAME_PAD - FRAME_STROKE, bb.YMin - FRAME_PAD - FRAME_STROKE,
                        bb.XMax + FRAME_PAD + FRAME_STROKE, bb.YMax + FRAME_PAD + FRAME_STROKE, 0, 1, FRAME_R)
    inner = rounded_box(bb.XMin - FRAME_PAD, bb.YMin - FRAME_PAD, bb.XMax + FRAME_PAD, bb.YMax + FRAME_PAD,
                        -1, 2, FRAME_R - FRAME_STROKE)
    frame = outer.cut(inner).Faces
    frame = [f for f in frame if abs(f.normalAt(0, 0).z + 1) < 1e-6]  # its underside: the ring at z=0
    return logo.fuse(frame).removeSplitter()


def logo_solid(extra=0.0):
    """The logo and frame LOGO_DEPTH deep below the lid top, plus `extra` above it."""
    faces = logo_faces().copy()
    faces.translate(V(0, 0, Z_TOP - LOGO_DEPTH))
    return faces.extrude(V(0, 0, LOGO_DEPTH + extra))


def build_lid():
    shell = rounded_box(OUT_X0, OUT_Y0, OUT_X1, OUT_Y1, Z_PCB_TOP, Z_TOP, R_OUT)
    v = shell.Volume
    cavity = rounded_box(IN_X0, IN_Y0, IN_X1, IN_Y1, Z_PCB_TOP - 1, Z_TOP - LID_T, max(R_OUT - WALL, 0.5))
    lid = checked(shell.cut(cavity), v * 0.2, "lid cavity")
    for (x, y) in HOLES:
        post = Part.makeCylinder(BOSS_D / 2, Z_TOP - LID_T - Z_PCB_TOP + 0.5, V(x, y, Z_PCB_TOP))
        upper = Part.makeCylinder(POST_D / 2, Z_TOP - LID_T - Z_PCB_TOP - POST_STEP + 0.5,
                                  V(x, y, Z_PCB_TOP + POST_STEP))
        lid = checked(lid.fuse([post, upper]), lid.Volume, f"post {x},{y}")
        # the bore stops under the lid top, so no screw shows there
        bore = Part.makeCylinder(SCREW_D / 2, Z_TOP - LID_T - Z_PCB_TOP + 1, V(x, y, Z_PCB_TOP - 1))
        lid = checked(lid.cut(bore.fuse(nut_slot(x, y))), lid.Volume, f"screw bore {x},{y}")
    for o in OPENINGS:
        lid = checked(lid.cut(opening_cutter(o)), lid.Volume, o["ref"])
    return checked(lid.cut(logo_solid(extra=1.0)), lid.Volume, "logo")


def fit_check():
    pcb = Part.makeBox(PCB_W, PCB_D, PCB_T, V(0, 0, Z_PCB_BOT))
    for (x, y) in HOLES:
        pcb = pcb.cut(Part.makeCylinder(HOLE_D / 2, PCB_T + 2, V(x, y, Z_PCB_BOT - 1)))
    parts = [("PCB", pcb),
             ("U1 ESP32 module", Part.makeBox(MODULE["x1"] - MODULE["x0"], MODULE["y1"] - MODULE["y0"],
                                              MODULE["h"], V(MODULE["x0"], MODULE["y0"], Z_PCB_TOP)))]
    for ref, x0, x1, y0, y1, h in FIT:
        parts.append((ref, Part.makeBox(x1 - x0, y1 - y0, h, V(x0, y0, Z_PCB_TOP))))
    return parts


def mesh_of(shape):
    return MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.05, AngularDeflection=0.2)


def write_3mf(base, lid, inlay, path):
    """Both parts on one plate as printed: the base as modelled, the lid on its top beside it.

    The lid is one object of two parts, its body on filament 1 and the logo on filament 2,
    so the logo prints in whatever colour slot 2 holds. The parts are declared the way
    Bambu Studio and OrcaSlicer read them: components plus Metadata/model_settings.config.
    """
    flip = lid.copy()
    flip.rotate(V(0, 0, 0), V(1, 0, 0), 180)
    bb = flip.BoundBox
    shift = V(base.BoundBox.XMax + 10 - bb.XMin, base.BoundBox.YMin - bb.YMin, -bb.ZMin)

    def flipped(shape):
        c = shape.copy()
        c.rotate(V(0, 0, 0), V(1, 0, 0), 180)
        c.translate(shift)
        return c

    def topology(shape):
        pts, tris = mesh_of(shape).Topology
        return [(p.x, p.y, p.z) for p in pts], list(tris)

    def mesh_xml(verts, tris):
        return ("   <mesh>\n    <vertices>\n"
                + "".join(f'     <vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>\n' for x, y, z in verts)
                + "    </vertices>\n    <triangles>\n"
                + "".join(f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>\n' for a, b, c in tris)
                + "    </triangles>\n   </mesh>\n")

    objects = [("Base", [("Base", topology(base), 1)]),
               ("Lid", [("Lid", topology(flipped(lid)), 1), ("Logo", topology(flipped(inlay)), 2)])]
    resources, build, config = [], [], []
    next_id = 1
    for name, parts in objects:
        part_ids = []
        for pname, (verts, tris), _ in parts:
            resources.append(f'  <object id="{next_id}" type="model" name="{pname}">\n'
                             + mesh_xml(verts, tris) + "  </object>\n")
            part_ids.append(next_id)
            next_id += 1
        resources.append(f'  <object id="{next_id}" type="model" name="{name}">\n   <components>\n'
                         + "".join(f'    <component objectid="{i}"/>\n' for i in part_ids)
                         + "   </components>\n  </object>\n")
        config.append(f'  <object id="{next_id}">\n    <metadata key="name" value="{name}"/>\n'
                      + "".join(f'    <part id="{i}" subtype="normal_part">\n'
                                f'      <metadata key="name" value="{pname}"/>\n'
                                f'      <metadata key="extruder" value="{filament}"/>\n    </part>\n'
                                for i, (pname, _, filament) in zip(part_ids, parts))
                      + "  </object>\n")
        build.append(f'  <item objectid="{next_id}"/>\n')
        next_id += 1

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    files = {
        "[Content_Types].xml": xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
        ' <Default Extension="config" ContentType="text/xml"/>\n</Types>\n',
        "_rels/.rels": xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        ' <Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n',
        "3D/3dmodel.model": xml + '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n'
        + "".join(resources) + " </resources>\n <build>\n" + "".join(build) + " </build>\n</model>\n",
        "Metadata/model_settings.config": xml + "<config>\n" + "".join(config) + "</config>\n",
    }
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))  # reproducible bytes
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


def main():
    os.makedirs(GENERATED, exist_ok=True)
    check_openings_clear_bosses()
    doc = App.newDocument("enclosure")
    doc.License = "MIT"  # FreeCAD defaults to "All rights reserved"; the repo is MIT
    doc.LicenseURL = "https://opensource.org/licenses/MIT"
    base, lid = build_base(), build_lid()
    inlay = logo_solid()
    for name, shp in (("Base", base), ("Lid", lid), ("Logo", inlay)):
        mesh = mesh_of(shp)
        if not (all(s.isClosed() for s in shp.Solids) and mesh.isSolid() and not mesh.hasNonManifolds()):
            raise RuntimeError(f"{name} would not print as a closed, manifold solid")
        obj = doc.addObject("Part::Feature", name)
        obj.Shape = shp
        shp.exportStep(os.path.join(GENERATED, f"enclosure-{name.lower()}.step"))
        mesh.write(os.path.join(GENERATED, f"enclosure-{name.lower()}.stl"))
        print(f"{name}: {shp.Volume / 1000:.1f} cm3, Z {shp.BoundBox.ZMin:.1f}..{shp.BoundBox.ZMax:.1f}")
    grp = doc.addObject("App::DocumentObjectGroup", "FitCheck")
    for name, shp in fit_check():
        o = doc.addObject("Part::Feature", name.split()[0] + "_fit")
        o.Label = name + " (fit check)"
        o.Shape = shp
        grp.addObject(o)
        for part_name, part in (("Base", base), ("Lid", lid)):
            clash = part.common(shp).Volume
            if clash > 0.01:
                raise RuntimeError(f"{name} collides with the {part_name}: {clash:.2f} mm3")
    doc.recompute()
    fcstd = os.path.join(SRC, "enclosure.FCStd")
    if os.path.exists(fcstd):
        os.remove(fcstd)  # saving over it would leave a .FCBak beside it
    doc.saveAs(fcstd)
    write_3mf(base, lid, inlay, os.path.join(GENERATED, "enclosure.3mf"))
    print(f"outer {OUT_X1 - OUT_X0:.1f} x {OUT_Y1 - OUT_Y0:.1f} x {Z_TOP:.1f} mm, split at Z={Z_PCB_TOP:.1f}")


main()
