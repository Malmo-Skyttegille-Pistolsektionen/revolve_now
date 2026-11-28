# Hardware

KiCad sources for the Revolve Now boards. Each board is kept at its current
revision, rev 2; earlier revisions are not in the repository.

| Directory | Board | KiCad project |
|---|---|---|
| [`main/`](main/README.md) | Main board: ESP32-S3, target outputs, trigger inputs, Ethernet, audio | `revolvenow_main.kicad_pro` |
| [`controller/`](controller/README.md) | Controller board (the relay box): eight MOSFETs that switch the target outputs, no microcontroller | `revolvenow_controller.kicad_pro` |
| [`lib/`](lib/) | Symbols, footprints and logos shared by the boards | — |

## Opening a project

Open the board's `.kicad_pro` in KiCad 10; the files are saved by 10.0.6. Each
board directory's `fp-lib-table` points at `lib/revolvenow.pretty`, so keep
the board directories and `lib/` side by side.

## Fabrication output

Each board keeps what was sent to the fab in `<board>/fab/rev2/`:

| Path | What it is |
|---|---|
| `gerber/` | Gerbers and drill files, plotted output with the file names KiCad gave them |
| `revolvenow_<board>_rev2.zip` | The same files, zipped for upload to the fab |
| `revolvenow_<board>.pdf` | The schematic, printed to PDF |

Pictures of each board are in its README, rendered from the `.kicad_pcb` with
`kicad-cli`.
