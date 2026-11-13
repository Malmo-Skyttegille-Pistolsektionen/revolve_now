# Enclosure

A 3D-printable box for the rev 2 board: a base tray the board screws into and a lid that drops over the connectors. It is 105 × 105 × 26.6 mm, with the Revolve Now logo in a rounded frame on the lid, printed in a second colour. Four screws hold it together from underneath, so the top shows no screws.

| Path | What it is |
|---|---|
| `src/enclosure.py` | The parametric model and the only source. Every dimension is a named constant at the top |
| `src/enclosure.FCStd` | The same model in FreeCAD, with stand-ins for the board and its tall parts in a `FitCheck` group |
| `generated/enclosure.3mf` | For Bambu Studio and OrcaSlicer. Both parts on one plate, laid out as printed: the base as modelled, the lid upside down beside it. Plate footprint 220 × 105 mm |
| `generated/enclosure-{base,lid,logo}.step` | Each part on its own, in the more exact format. Bambu Studio imports STEP directly |
| `generated/enclosure-{base,lid,logo}.stl` | Each part as a mesh, for slicers or printing services that only take STL |

Everything under `generated/` is written by the script; edit `src/enclosure.py` and regenerate rather than changing an export.

## What it fits

The positions come from the rev 2 layout, `hardware/main/revolvenow_main.kicad_pcb` (PR #436):

- **Connector edge:** J1 and J2 (Turn 0-3 and 4-7 RJ45s), the J7 audio jack and the U11 Ethernet MagJack.
- **Left edge:** J8 and J6 (Turn 12-15 and 8-11 RJ45s) and J3 (Trigger RJ45).
- **USB-C edge:** J4.
- **Back edge:** closed. The ESP32 module sits inside the board outline with its antenna over a notch in the board, so nothing pokes out.
- **Status LED:** a 3 mm hole in the lid top over D8, the WS2812B. Set `LED_WINDOW_D = 0` for a closed lid.
- **Mounting:** the four 4.7 mm corner holes.
- **Logo:** the logo inside a rounded-rectangle frame, 0.6 mm deep in the lid top, upright when the connector edge faces you. It is read from `webapp/public/revolve-now-logo.svg` at generation time, so the box follows the web app's logo. The `logo` part fills it flush; in the 3MF it is a part of the lid on filament 2.

The J5 UART header and the J9 jumper header stay inside; take the lid off to reach them. The box for the rev 1 board is in the git history of this directory.

## Check before printing

The KiCad project has no 3D models, so connector heights and face widths are typical datasheet values, not measurements:

| Part | Assumed | Constant |
|---|---|---|
| RJ45 J1/J2/J3/J6/J8 | 16 mm wide, 13.5 mm tall | `OPENINGS`, `FIT` |
| MagJack U11 | 16.2 mm wide, 13.6 mm tall | `OPENINGS`, `FIT` |
| Audio J7 | barrel axis 2.6 mm above the board | `OPENINGS` |
| USB-C J4 | connector centre 1.63 mm above the board | `OPENINGS` |
| Pin headers J5/J9 | 8.5 mm tall with a jumper on | `FIT` |

The openings are deliberately generous for a first test print, at least 1 mm around each connector body. Tighten them in `OPENINGS` once a print fits. Measure the board you have, update the constants, and regenerate.

The ribs between J1 and J2, and between J8 and J6, are 1.2 mm wide. They print, but handle the lid with care until the connectors are in them.

## Printing and assembly

- **No supports needed.** `enclosure.3mf` already has both parts the right way up: the base as modelled, the lid upside down. Every connector opening is a notch open towards the split line, and the counterbores under the base have one-layer bridging steps (`LAYER`, 0.2 mm) so their ceilings print clean.
- **Logo colour:** the logo is on filament 2 and the rest on filament 1; pick any colour for either in the slicer. Since the lid prints face down, the logo and frame are its first three layers. With a single filament, set both to the same one, or pause at 0.6 mm to swap.
- **Hardware:** 4 × M3×12 socket-head screws (ISO 4762; M3×10 to M3×20 fit) and 4 × M3 × 5.7 heat-set inserts.
- **Lid:** press an insert into the end of each lid post (4.0 mm hole, 6 mm deep), flush with the end.
- **Assembly:** lay the board on the standoffs, put the lid on, turn the box over and drive the screws up through the base into the inserts. The heads sit flush in the base's underside, and the lid top stays closed.

## Regenerating

With FreeCAD 1.1 (`freecadcmd` ships with it; the AppImage takes it as its first argument):

```bash
freecadcmd hardware/enclosure/src/enclosure.py
# or: FreeCAD.AppImage freecadcmd hardware/enclosure/src/enclosure.py
```

This rewrites `src/enclosure.FCStd` and everything in `generated/`. The script refuses to save a part that isn't a single closed, manifold solid, and it also fails if a stand-in collides with the walls.
