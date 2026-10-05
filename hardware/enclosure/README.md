# Enclosure

A 3D-printable box for the rev 1 board: a base tray the board screws into and a lid that drops over the connectors. It is 105 × 110.8 × 26.6 mm.

| File | What it is |
|---|---|
| `enclosure.py` | The parametric model and the only source. Every dimension is a named constant at the top |
| `enclosure-base.step`, `enclosure-lid.step` | The two parts, ready for a slicer. Bambu Studio and PrusaSlicer import STEP directly, and it is the more exact format |
| `enclosure-base.stl`, `enclosure-lid.stl` | The same two parts as meshes, for slicers or printing services that only take STL |
| `enclosure.FCStd` | The same model in FreeCAD, with stand-ins for the board and its tall parts in a `FitCheck` group |

## What it fits

The positions come from `hardware/revolvenow_hardware.kicad_pcb`:

- **Connector edge:** J1 and J2 (Power/Turn RJ45s), the J7 audio jack and the U11 Ethernet MagJack.
- **USB-C edge:** J4.
- **Antenna side:** the ESP32 module overhangs the board edge by 5.25 mm, so the box is deeper on that side. Nothing but plastic surrounds the antenna.
- **Mounting:** the four 4.7 mm corner holes.

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

- **No supports needed.** Print the base as modelled and the lid upside down; every connector opening is a notch open towards the split line.
- **Base:** press an M3 heat-set insert into each standoff (4.0 mm hole, 6 mm deep).
- **Assembly:** lay the board on the standoffs, put the lid on, and fit 4 × M3×25 pan-head screws from the top. They clamp the board between the lid posts and the standoffs.

## Regenerating

With FreeCAD 1.1 (`freecadcmd` ships with it; the AppImage takes it as its first argument):

```bash
freecadcmd hardware/enclosure/enclosure.py
# or: FreeCAD.AppImage freecadcmd hardware/enclosure/enclosure.py
```

This rewrites all five output files. The script refuses to save a part that isn't a single closed, manifold solid, and it also fails if a stand-in collides with the walls.
