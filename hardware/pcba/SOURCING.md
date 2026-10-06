# PCBA rev 1 — sourcing and verification

What goes on the PCBA rev 1 board — the line that JLCPCB delivers assembled, kept apart from Franz's hand-built line in `hardware/`, which has its own revision count — which LCSC part it is, and what each choice was
checked against. The design decision is [D-49](../../docs/DECISIONS.md); the
review of the hand-built rev 1 that this board answers is on
[PR #436](https://github.com/Malmo-Skyttegille-Pistolsektionen/revolve_now/pull/436).
Stock and prices are LCSC on 2026-10-06 and will drift.

A row is in the **verified** table only when the datasheet was read and, for a
part that lands on an existing footprint, its pads were compared with the pads
in `revolvenow_hardware.kicad_pcb` (position error given). Anything else is in
**open**, and stays out of the design until it moves up.

## Verified

| Ref | Part | LCSC | Checked against | Result |
|---|---|---|---|---|
| U1 | ESP32-S3-WROOM-1-N16R8 | C2913202 | Espressif module datasheet, table 3-1 | pin 13 = GPIO19 = USB_D−, pin 14 = GPIO20 = USB_D+ |
| U2 | PCM5102APWR | C107671 | standard TSSOP-20 footprint | unchanged |
| U3–U5 | LTV-847S | C114599 | Lite-On datasheet; pads vs board | VF 1.2 V typ / 1.4 max, IF ≤ 50 mA, VR 6 V, CTR ≥ 50 % at 5 mA; pads within 0.39 mm |
| U6 | AMS1117-3.3 | C6186 | basic part, SOT-223 | unchanged |
| U9 | LM75BD,118 | C34565 | standard SOIC-8 | unchanged |
| U10 | W5500 | C32843 | WIZnet datasheet v1.1.0 | LINKLED/ACTLED active-low, IOH ≥ 12.5 mA; RSVD pin 23 "must be tied to GND" |
| U11 | HR911105A | C12074 | HanRun datasheet rev A/2; generated footprint vs drawing | P1/P2 TD±, **P4 TX CT, P5 RX CT**, P3 RD+, P6 RD−, P7 NC, P8 CHS GND; LEDs 9→10, 12→11 (anode first); footprint matches drawing on every dimension |
| J1–J3 | R-RJ45R08P-A004 | C385834 | Ckmtw drawing; generated footprint vs drawing | 1.02 mm pitch, 1.78 mm rows, Ø3.25 pegs 12.70 apart — all match |
| J4 | TYPE-C-31-M-12 | C165948 | pads vs board `USB Type-C-02` | within 0.15 mm, same merged A1/B12 and A4/B9 pads |
| J7 | PJ-320A (XKB) | C2884926 | pads vs board | within 0.53 mm on the sleeve pin, exact on the rest |
| Y2 | 25 MHz oscillator 3225 | C496680 | pads vs board | within 0.07 mm |
| D6–D11 | SK9822 | C2829089 | OPSCO datasheet B/1; pads vs board | pins 1–6 = SDI, CKI, GND, VDD, CKO, SDO, same as the board's D-pins; 0.1 mm; VIH 0.75·VDD |
| U12, U13 (new) | SN74AHCT1G125DBVR | C7484 | TI part, 4.5–5.5 V | non-inverting buffers for LED data and clock, replacing Q3/Q4 |
| D2, D3 → one part | USBLC6-2SC6 | C7519 | ST datasheet figure 1 | pins 1/6 line 1, 3/4 line 2, 2 GND, 5 VBUS |
| D4 | SMBJ5.0A | C78423 | Brightking datasheet | 5 V stand-off, 6.4 V breakdown, replaces the 18 V part |
| FB1 | BLM21PG221SN1D | C85840 | Murata part, 0805 | 2 A, 220 Ω at 100 MHz. The whole 5 V supply passes FB1 (module peaks ~355 mA plus up to ~360 mA for six LEDs), so the common 500 mA 600 Ω bead is too small |
| L1 | BLM18PG121SN1D | C14709 | WIZnet hardware design guide | bead between VDD and AVDD, 100–2000 Ω at 100 MHz; this one is 120 Ω, 2 A |
| R26, R27 | 5.1 kΩ | basic | USB-C spec | fitted, so a C-to-C supply turns VBUS on |
| C14 | 22 µF 6.3 V X5R 0603 | C59461 | basic part | the only 22 µF in 0603; 6.3 V on a 3.3 V rail |
| passives | 0603 R and C | basic | — | every value in the BOM has a basic-library part |

## Changes to the hand-built rev 1 schematic

Numbered as in the PR #436 review; N1 is new.

| Item | Change |
|---|---|
| M1 | `U2` DGND to GND; GNDA to GND at one point under the DAC |
| M2 | LED data moves to GPIO2; GPIO0 gets a 10 k pull-up and carries only BOOT |
| M3 | `D2`/`D3` become one USBLC6-2SC6 on D±; `D4` becomes SMBJ5.0A |
| M4 | `R26`/`R27` fitted |
| S1 | trigger resistors at ~5 mA: 330 Ω (3.3 V), 750 Ω (5 V), 2.2 kΩ (12 V) |
| S2 | BAV99 antiparallel across each opto LED |
| S4 | `U10` RSVD (pin 23) to GND; RSTn to a GPIO with 10 k and 100 nF |
| S5 | `fp-lib-table` added; `.kicad_prl` dropped |
| C1 | native USB; `U7`, `Q1`, `Q2`, `R18`–`R21`, `R24`, `R25`, `R47`, `D5` go; TX0/RX0/GND on a 3-pin header |
| C2 | `Q3`/`Q4` become two 74AHCT1G125 |
| **N1** | `U11` LED anodes (9, 12) to 3.3 V through 330 Ω, cathodes (10, 11) to the W5500 LED pins. The hand-built rev 1 has them the other way round, so both LEDs light when there is *no* link / activity |

## Open — not in the design until answered

| Ref | Question | Who |
|---|---|---|
| R43 | What voltage does the equipment on J3 pins 1–2 put out? The channel is unfitted until this is known | designer |
| J3 | Are the 3.3 V / 5 V / 12 V labels the voltages used on the range? | designer |
| J1 | Which RJ45 is fitted on the rev 1 boards? If known, its footprint can stay | designer |
| U8 | MX25L3233FMI-08G (C2802999) is 16-pin as the footprint needs, but 69 in stock at $3.72, and the firmware does not use it. Fit or leave empty? | club |
| — | Final cost: the quote below is for this parts list on the hand-built rev 1 copper. The PCBA rev 1 Gerbers will change it a little | — |

## Quote, 2026-10-06

JLCPCB online quote, logged in, Standard PCBA, top side, the smallest order
(5 PCBs, 2 of them assembled). Board: the hand-built rev 1 Gerbers (same
100 × 100 mm, 2 layers). Parts: this file's verified list, 47 LCSC lines and
142 placements. Shipping and Swedish import VAT come on top.

| Item | USD |
|---|--:|
| PCB: engineering fee $4.00 + boards $5.30 | 9.30 |
| Setup fee | 25.75 |
| Stencil | 8.27 |
| Components, 47 lines incl. attrition | 46.91 |
| Feeders loading (extended parts, per order) | 68.20 |
| SMT assembly | 3.34 |
| Hand soldering (through-hole) | 3.61 |
| Manual assembly | 1.45 |
| X-ray inspection | 3.30 |
| Packaging | 0.50 |
| **Total, 2 assembled + 3 bare** | **170.63** |

About $107 of that ($25.75 setup + $8.27 stencil + $68.20 feeders + $4.00
engineering) is per order, not per board, so each further board costs roughly
the components and labour, about $30. The heaviest single parts are the
ESP32 module ($10.27 for two) and the flash ($7.43 for two), which the firmware
does not use. Weight 1.03 kg; to Sweden JLC offered DHL Express without DDP,
so 25 % VAT and DHL's handling fee are charged on delivery.

## Rejected

- **Pulse J0026D21BNL via JLC global sourcing** — no footprint change, but no
  stock, several dollars more per jack and weeks of lead time.
- **Keeping the FT232RL** — $7.25, the most expensive part on the board, and
  its only job is done by the module's own USB.
- **KH-6X6X5H-STM (C2837531) on the rev 1 switch pads** — its pads sit
  0.57 mm outboard of the PTS645 pads; PCBA rev 1 uses its own footprint.
