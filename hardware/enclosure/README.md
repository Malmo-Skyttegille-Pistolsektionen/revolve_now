# Enclosure

A 3D-printable box for the rev 1 board: a base tray the board screws into and a lid that drops over the connectors. It is 105 × 105 × 26.6 mm, with the Revolve Now logo engraved in the lid.

| Path | What it is |
|---|---|
| `src/enclosure.py` | The parametric model and the only source. Every dimension is a named constant at the top |
| `src/enclosure.FCStd` | The same model in FreeCAD, with stand-ins for the board and its tall parts in a `FitCheck` group |
| `generated/enclosure.3mf` | Both parts on one plate, laid out as printed: the base as modelled, the lid upside down beside it. Plate footprint 220 × 105 mm |
| `generated/enclosure-{base,lid}.step` | Each part on its own, in the more exact format. Bambu Studio and PrusaSlicer import STEP directly |
| `generated/enclosure-{base,lid}.stl` | Each part as a mesh, for slicers or printing services that only take STL |

Everything under `generated/` is written by the script; edit `src/enclosure.py` and regenerate rather than changing an export.

## What it fits

The positions come from `hardware/revolvenow_hardware.kicad_pcb`:

- **Connector edge:** J1 and J2 (Power/Turn RJ45s), the J7 audio jack and the U11 Ethernet MagJack.
- **USB-C edge:** J4.
- **Antenna side:** the ESP32 module overhangs the board edge by 5.25 mm and pokes out through a slot in the back wall, as it does on the bare board. Set `ANTENNA_CUTOUT = False` to keep it inside a deeper back bay instead; the box is then 110.8 mm deep.
- **Mounting:** the four 4.7 mm corner holes.
- **Logo:** engraved 0.6 mm into the lid top, upright when the connector edge faces you. It is read from `webapp/public/revolve-now-logo.svg` at generation time, so the box follows the web app's logo.

J3, the trigger RJ45, is not fitted on rev 1, so its wall is closed. Set `TRIGGER_OPENING = True` to cut it.

## Check before printing

The KiCad project has no 3D models, so connector heights and face widths are typical datasheet values, not measurements:

| Part | Assumed | Constant |
|---|---|---|
| RJ45 J1/J2 | 16 mm wide, 13.5 mm tall | `OPENINGS`, `FIT` |
| MagJack U11 | 16.2 mm wide, 13.6 mm tall | `OPENINGS`, `FIT` |
| Audio J7 | barrel axis 2.6 mm above the board | `OPENINGS` |
| USB-C J4 | connector centre 1.63 mm above the board | `OPENINGS` |

Measure the board you have, update the constants, and regenerate. The rev 1 boards in use play audio through a PCM5102A breakout glued onto the board, whose jack is not where J7 is. Measure that jack's position too if the box is for one of those boards.

## Printing and assembly

- **No supports needed.** `enclosure.3mf` already has both parts the right way up: the base as modelled, the lid upside down. Every connector opening is a notch open towards the split line.
- **Base:** press an M3 heat-set insert into each standoff (4.0 mm hole, 6 mm deep).
- **Assembly:** lay the board on the standoffs, put the lid on, and fit 4 × M3×25 pan-head screws from the top. They clamp the board between the lid posts and the standoffs.

## Regenerating

With FreeCAD 1.1 (`freecadcmd` ships with it; the AppImage takes it as its first argument):

```bash
freecadcmd hardware/enclosure/src/enclosure.py
# or: FreeCAD.AppImage freecadcmd hardware/enclosure/src/enclosure.py
```

This rewrites `src/enclosure.FCStd` and everything in `generated/`. The script refuses to save a part that isn't a single closed, manifold solid, and it also fails if a stand-in collides with the walls.
