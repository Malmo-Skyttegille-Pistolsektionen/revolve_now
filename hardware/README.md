# Hardware

KiCad projects for the Revolve Now boards. Open the `.kicad_pro` in each board directory.

| Directory | Board |
|---|---|
| `main/` | Main board (ESP32-S3) |
| `lib/` | Symbols, footprints and logos shared by the boards |

Each board keeps its fabrication output per revision in `fab/<rev>/` (gerbers,
PDF and the zip sent to the fab). The gerbers are plotted output and keep the
file names KiCad gave them.
