---
name: Rotation Target
description: Range-side control for a rotating pistol target — equipment that happens to have a screen.
colors:
  # The light theme, and the names of the CSS custom properties: `ink` is
  # `--rt-ink` in src/theme.css. Dark values are in the Colors section below.
  page: '#ffffff'
  surface: '#ffffff'
  surface-sunken: '#fafafa'
  surface-muted: '#f3f4f6'
  fill: '#e5e7eb'
  fill-hover: '#d1d5db'
  border: '#e5e7eb'
  border-strong: '#d1d5db'
  border-hover: '#9ca3af'
  ink: '#111827'
  text: '#213547'
  text-strong: '#374151'
  text-subtle: '#4b5563'
  text-muted: '#6b7280'
  on-fill: '#ffffff'
  focus: '#2563eb'
  action: '#2563eb'
  action-deep: '#1d4ed8'
  action-text: '#1d4ed8'
  action-tint: '#eff6ff'
  action-tint-strong: '#dbeafe'
  accent: '#6366f1'
  accent-deep: '#4338ca'
  accent-ink: '#312e81'
  accent-tint: '#eef2ff'
  accent-border: '#c7d2fe'
  accent-fill: '#4338ca'
  accent-fill-deep: '#3730a3'
  shown: '#16a34a'
  shown-ink: '#15803d'
  shown-text: '#14532d'
  shown-tint: '#dcfce7'
  shown-tint-soft: '#f0fdf4'
  go: '#15803d'
  go-deep: '#166534'
  stop: '#dc2626'
  stop-deep: '#b91c1c'
  stop-ink: '#dc2626'
  stop-ink-deep: '#b91c1c'
  stop-text: '#7f1d1d'
  stop-tint: '#fee2e2'
  stop-tint-soft: '#fef2f2'
  stop-border: '#fca5a5'
  warn: '#92400e'
  warn-ink: '#b45309'
  warn-fill: '#b45309'
  warn-fill-deep: '#92400e'
  warn-tint: '#fef3c7'
  warn-tint-strong: '#fde68a'
  warn-tint-soft: '#fffbeb'
  warn-border: '#fcd34d'
typography:
  # Eight steps, and every font-size in src/ is one of them. The ramp was
  # derived from what the app already shipped rather than imposed on it: the
  # sizes carrying real weight (0.85rem across 51 rules, 0.9rem across 37) were
  # simply never written down here, so the documented ramp and the CSS had
  # drifted apart in both directions.
  #
  # What was removed were the accidental near-duplicates - 0.7 beside 0.75,
  # 0.8 and 0.875 beside 0.85, and three components that each invented their
  # own `.title` size (1.05, 1.2, 1.25). Nothing moved by more than 0.15rem.
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: 'clamp(4.5rem, 24vw, 7rem)'
    fontWeight: 700
    lineHeight: 1
    fontVariation: 'tabular-nums'
    usage: "The run screen's countdown, and nothing else."
  timer:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: 'clamp(1.5rem, 5vw, 2rem)'
    fontWeight: 600
    lineHeight: 1.2
    usage: "The sticky timer that follows a run. Fluid on purpose - it has to stay readable on a phone held at arm's length and not dominate a laptop."
  headline:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.3
    usage: "Page headings, and the timeline's duration readout."
  title:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '1.1rem'
    fontWeight: 600
    lineHeight: 1.4
    usage: 'Section and card titles. The one step three components had each guessed differently.'
  lead:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.5
    usage: 'Controls that need to outweigh body text - a primary button, a card title in a dense list.'
  bodyLarge:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '0.95rem'
    fontWeight: 400
    lineHeight: 1.5
    usage: 'Text the operator reads off a device at the range: table cells, form inputs, read-only values.'
  body:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '0.9rem'
    fontWeight: 400
    lineHeight: 1.5
    usage: 'The default. Buttons, labels, most prose.'
  small:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '0.85rem'
    fontWeight: 400
    lineHeight: 1.5
    usage: 'Supporting text under a control - hints, metadata, error detail. The most-used size in the app.'
  label:
    fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: '0.05em'
    usage: 'Badges, group headings, tick labels. Anything set in caps.'
rounded:
  sm: '4px'
  md: '6px'
  lg: '8px'
  xl: '12px'
  pill: '999px'
spacing:
  xs: '0.25rem'
  sm: '0.5rem'
  md: '0.75rem'
  lg: '1rem'
  xl: '1.5rem'
  xxl: '2rem'
components:
  button-default:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.sm}'
    padding: '0.4rem 0.75rem'
    height: 'var(--rt-control-height)'
    typography: '{typography.body}'
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.on-fill}'
    rounded: '{rounded.sm}'
    padding: '0.4rem 0.75rem'
    height: 'var(--rt-control-height)'
  button-primary-hover:
    backgroundColor: '{colors.action-deep}'
    textColor: '{colors.on-fill}'
  button-destructive:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.stop-ink}'
    rounded: '{rounded.sm}'
    padding: '0.4rem 0.75rem'
  button-destructive-hover:
    backgroundColor: '{colors.stop-tint}'
    textColor: '{colors.stop-ink}'
  button-go:
    backgroundColor: '{colors.go}'
    textColor: '{colors.on-fill}'
    rounded: '{rounded.lg}'
    padding: '0.75rem 1.5rem'
    height: '48px'
  button-stop:
    backgroundColor: '{colors.stop}'
    textColor: '{colors.on-fill}'
    rounded: '{rounded.lg}'
    padding: '0.75rem 1.5rem'
    height: '48px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.sm}'
    padding: '0.35rem 0.5rem'
    typography: '{typography.body}'
  badge-shown:
    backgroundColor: '{colors.shown-tint}'
    textColor: '{colors.shown-text}'
    rounded: '{rounded.md}'
    padding: '0 0.75rem'
    height: '36px'
  badge-hidden:
    backgroundColor: '{colors.stop-tint}'
    textColor: '{colors.stop-text}'
    rounded: '{rounded.md}'
    padding: '0 0.75rem'
    height: '36px'
  badge-neutral:
    backgroundColor: '{colors.surface-muted}'
    textColor: '{colors.text-strong}'
    rounded: '{rounded.md}'
    padding: '0 0.75rem'
    height: '36px'
---

# Design System: Rotation Target

## Overview

**Creative North Star: "Equipment, not software"**

This is range equipment that happens to have a screen. It is read standing up,
outdoors, in daylight, by someone who is about to run a live firing exercise and
has better things to look at than a user interface. Every visual decision
answers to that scene: grey by default, colour only where colour carries a
safety meaning, and type sized so the one number that matters can be read at
arm's length without walking to the phone.

The system is deliberately quiet. There is no brand expression competing for
attention, because the three signal colours — green, red, amber — have fixed
operational meanings and must be impossible to mistake for decoration. When a
surface looks plain here, that is the design working, not the design missing.

Density is medium and consistent: one control height for the whole app, one
breakpoint, one type ramp. The interface should feel like a well-labelled panel
of switches, where nothing moves unless the state moved.

**Key Characteristics:**

- Neutral greys carry structure; hue is reserved for state
- One control height (40px pointer, 44px touch) governs every row
- Numbers are tabular so a readout never reflows as it counts
- Flat at rest — depth is a response, not an ornament
- Legibility in daylight outranks visual interest, always

## Colors

A near-monochrome grey system with three signal hues that mean specific things,
plus a blue for the ordinary "do the thing" action.

### Primary

- **Signal Blue** (`#2563eb`): the ordinary confirming action — Save, Add,
  Create. It is the only blue in the system and never carries state meaning; a
  blue button is something you press, not something the target is doing.

### Secondary

- **Indigo** (`#6366f1`): "this is the one running." Marks the active series in
  the timeline and the time badge on the run board. Used as a border and a tint,
  never as a large fill.
- **Deep Indigo** (`#4338ca`): the same signal where it has to be readable as
  text — the active series title on its tinted ground.

### Tertiary

- **Amber** (`#92400e` on `#fef3c7`): the advisory register. Startup issues,
  "no delay armed", anything the operator should notice but which does not stop
  the exercise.

### Neutral

- **Ink** (`#111827`): the countdown readout, and nothing else. It is the
  highest-contrast value in the system and reserved for the highest-stakes
  number.
- **Body Ink** (`#213547`): default text.
- **Strong Grey** (`#374151`): badge text, table headers.
- **Muted Grey** (`#6b7280`): secondary and supporting text — the single most
  used colour in the app.
- **Border Grey** (`#e5e7eb`) / **Strong Border** (`#d1d5db`): dividers, card
  edges, control outlines.
- **Surface** (`#ffffff`), **Sunken** (`#fafafa`), **Muted** (`#f3f4f6`): the
  three grounds. Layering is done with these, not with shadow.

### Dark theme

Settings offers System (the default, following `prefers-color-scheme`), Light
and Dark, kept in the browser like the server URL. The dark theme is the same
tokens with different values, never a second set of rules. It exists for the
range at night: a phone at arm's length under floodlights, where a white page
is the brightest thing in view.

It is composed, not inverted. Elevation runs the other way — the page is the
darkest ground (gray-900) and a card steps _up_ to gray-800, because a shadow
cannot be seen on a dark page. Text steps up the gray scale to stay above
4.5:1 on every ground it sits on, including `surface-muted`.

The signal hues split by job. A **fill** that carries white text (`go`,
`stop`, `action`, `accent-fill`, `warn-fill`) keeps its light value, because
white on it already clears 4.5:1 on any ground. An **ink** — the same hue used
as text or a line on the page (`stop-ink`, `shown-ink`, `warn-ink`,
`accent-deep`, `action-text`, `focus`) — moves to the 300–400 step, because
red-600 text on gray-800 does not. Tints drop to the 950 step. Green is still
shown, red still hidden, amber still no delay: the Three Signals Rule holds on
the dark ground by re-deriving each hue for contrast, not by flipping it.

`warn-tint-soft` (the Expert-mode ground) is stone-900 in the dark theme: amber
has no step dark enough to sit under a whole region without glowing.

| Token                | Light     | Dark      |
| -------------------- | --------- | --------- |
| `page`               | `#ffffff` | `#111827` |
| `surface`            | `#ffffff` | `#1f2937` |
| `surface-sunken`     | `#fafafa` | `#111827` |
| `surface-muted`      | `#f3f4f6` | `#374151` |
| `fill`               | `#e5e7eb` | `#374151` |
| `fill-hover`         | `#d1d5db` | `#4b5563` |
| `border`             | `#e5e7eb` | `#374151` |
| `border-strong`      | `#d1d5db` | `#4b5563` |
| `border-hover`       | `#9ca3af` | `#6b7280` |
| `ink`                | `#111827` | `#f9fafb` |
| `text`               | `#213547` | `#e5e7eb` |
| `text-strong`        | `#374151` | `#d1d5db` |
| `text-subtle`        | `#4b5563` | `#d1d5db` |
| `text-muted`         | `#6b7280` | `#9ca3af` |
| `on-fill`            | `#ffffff` | `#ffffff` |
| `focus`              | `#2563eb` | `#60a5fa` |
| `action`             | `#2563eb` | `#2563eb` |
| `action-deep`        | `#1d4ed8` | `#1d4ed8` |
| `action-text`        | `#1d4ed8` | `#93c5fd` |
| `action-tint`        | `#eff6ff` | `#172554` |
| `action-tint-strong` | `#dbeafe` | `#1e3a8a` |
| `accent`             | `#6366f1` | `#818cf8` |
| `accent-deep`        | `#4338ca` | `#a5b4fc` |
| `accent-ink`         | `#312e81` | `#c7d2fe` |
| `accent-tint`        | `#eef2ff` | `#1e1b4b` |
| `accent-border`      | `#c7d2fe` | `#3730a3` |
| `accent-fill`        | `#4338ca` | `#4338ca` |
| `accent-fill-deep`   | `#3730a3` | `#4f46e5` |
| `shown`              | `#16a34a` | `#22c55e` |
| `shown-ink`          | `#15803d` | `#4ade80` |
| `shown-text`         | `#14532d` | `#bbf7d0` |
| `shown-tint`         | `#dcfce7` | `#052e16` |
| `shown-tint-soft`    | `#f0fdf4` | `#052e16` |
| `go`                 | `#15803d` | `#15803d` |
| `go-deep`            | `#166534` | `#166534` |
| `stop`               | `#dc2626` | `#dc2626` |
| `stop-deep`          | `#b91c1c` | `#b91c1c` |
| `stop-ink`           | `#dc2626` | `#f87171` |
| `stop-ink-deep`      | `#b91c1c` | `#fca5a5` |
| `stop-text`          | `#7f1d1d` | `#fecaca` |
| `stop-tint`          | `#fee2e2` | `#450a0a` |
| `stop-tint-soft`     | `#fef2f2` | `#450a0a` |
| `stop-border`        | `#fca5a5` | `#991b1b` |
| `warn`               | `#92400e` | `#fcd34d` |
| `warn-ink`           | `#b45309` | `#fbbf24` |
| `warn-fill`          | `#b45309` | `#b45309` |
| `warn-fill-deep`     | `#92400e` | `#92400e` |
| `warn-tint`          | `#fef3c7` | `#451a03` |
| `warn-tint-strong`   | `#fde68a` | `#78350f` |
| `warn-tint-soft`     | `#fffbeb` | `#1c1917` |
| `warn-border`        | `#fcd34d` | `#b45309` |

### Named Rules

**The Three Signals Rule.** Green means the target is shown, red means it is
hidden, amber means no delay is armed. No other element may use those hues for
any other purpose — not for a decorative accent, not for a chart, not for a
brand flourish. If a new state needs a colour and is not one of those three
things, it uses indigo or a grey.

**The One Family Rule.** The palette is the Tailwind scale, and only the
Tailwind scale. Two earlier families used to be mixed in — the Vite starter
purple (`#646cff`, never chosen, just the `npm create vite` default) and
Material's greens and reds on the timeline event boxes. Both are gone. The
purple mattered because it sits close enough to the accent indigo to look
intentional and far enough to look wrong beside it, which is the worst distance
for two colours to be.

**The Readable Signal Rule.** Signal colours are chosen for contrast, not for
brightness. White text sits on green-700 (`#15803d`), never green-600, because
white on green-600 measures 3.3:1 and fails AA. Any new coloured surface must
clear 4.5:1 for its text before it ships.

## Typography

**Body Font:** Inter (with system-ui, Avenir, Helvetica, Arial fallbacks)
**Readout Font:** the platform system stack (`-apple-system`,
`BlinkMacSystemFont`, `Segoe UI`, Roboto), used only for the countdown so the
digits render in the device's most familiar, most hinted numerals.

**Character:** plain, neutral, unstyled. The type is not doing expressive work;
it is doing legibility work. Weight and size carry the hierarchy, and there are
only three weights in the whole system.

### Hierarchy

- **Display** (700, `clamp(4.5rem, 24vw, 7rem)`, line-height 1): the countdown
  digits alone. Scales _up_ with the viewport rather than down, and uses
  tabular numerals so the box does not resize as 10 becomes 9.
- **Headline** (600, 1.5rem): page titles.
- **Title** (600, 1.1rem–1.25rem): card and section headings, series titles.
- **Body** (400, 0.9rem): the workhorse. Table cells, descriptions, controls.
- **Label** (600, 0.75rem, 0.05em, uppercase): badge captions and field labels.
  Uppercase is the tell that something is a label and not content.

### Named Rules

**The Arm's Length Rule.** The countdown grows with the viewport instead of
shrinking with it. A phone held at the firing line is further from the eye than
a laptop on a desk, so `24vw` is the floor of the readout, not its ceiling.

**The Tabular Rule.** Any number that changes in place — countdown, elapsed
time, cumulative event time — is `font-variant-numeric: tabular-nums`. A
readout that jitters as its digits change is a readout nobody trusts.

## Layout

A single-column stack at every size, `1rem` page padding, `1rem` between cards.
Cards are full-bleed within that padding and do not have a max width; the
content is tables and timelines, both of which want the room.

**One breakpoint: 768px.** Below it, button rows become full-width columns,
event chips reflow, and tables switch to their compact presentation. Above it,
navigation tabs stop stretching to fill the bar. There is no tablet-specific
layout and there should not be one — the phone layout serves a tablet held in
two hands perfectly well.

**One control height.** `--rt-control-height` is the only global custom
property in the app: 40px for a mouse, 44px under `@media (pointer: coarse)` so
a gloved hand on the firing line gets the platform minimum tap target. Buttons,
selects, inputs and nav links all adopt it, which is what keeps a row of mixed
controls visually aligned.

Navigation is sticky at the top (`z-index: 30`). The run page is metres of
timeline on a phone, and the tabs have to stay reachable without scrolling back.

### Named Rules

**The No Nested Scroller Rule.** The document scrolls; panels do not. A flex
child with `overflow-y: auto` also computes `overflow-x: auto`, which silently
clipped the programs and audios tables off the right edge on a phone. Wide
content gets its own explicitly scrollable wrapper; layout containers get
`min-width: 0` instead.

## Elevation & Depth

**Flat at rest.** Surfaces separate by background tone and a hairline border,
not by shadow. This is a daylight interface: soft shadows wash out in sun and
cost more to composite on the device's embedded browser, while a 1px border at
`#e5e7eb` stays crisp in both.

Shadow is reserved for two jobs: things that genuinely float above the page,
and feedback that something responded to you.

### Shadow Vocabulary

- **Overlay** (`0 25px 50px -12px rgba(0, 0, 0, 0.25)`): modal dialogs only —
  the countdown and the confirmation. These really are above the page.
- **Response** (`0 2px 8px rgba(0, 0, 0, 0.1)`): hover and active feedback on
  an interactive card.
- **Lift** (`0 4px 12px rgba(0, 0, 0, 0.08)`): the running series. Neutral, not
  tinted — the indigo border already says "this is running"; a coloured halo
  under it only says "decorated".
- **Focus ring** (`0 0 0 3px <colour>/0.1`, or `outline: 2px solid #2563eb`
  with `2px` offset): keyboard focus. Never removed, never subtle.

### Named Rules

**The Flat-By-Default Rule.** A card gets a border, not a shadow. If you are
reaching for `box-shadow` on a resting surface, the answer is a tone change or
a border.

**The Neutral Elevation Rule.** Shadows are black at low alpha. A shadow tinted
to match its element's accent colour is decoration pretending to be depth.

## Shapes

A modest, consistent radius ramp and no other form language — no clipping, no
angles, no decorative geometry.

- **4px** — controls: buttons, inputs, nav links. The tightest radius, for the
  things you touch.
- **6px** — badges, chips, nested panels within a card.
- **8px** — cards and control boards.
- **12px** — modal dialogs, the largest surface and the largest radius.
- **999px** — pills, used sparingly for count indicators.

Borders are 1px for structure and 2px when the border itself is the signal (a
state badge, the active series).

### Named Rules

**The Side-Tab Ban.** No thick coloured border on one edge of a card. It is the
most recognisable tell of machine-generated UI, and this system says "warning"
with a tinted ground and a full hairline border instead.

## Components

### Buttons

- **Shape:** tight radius (4px), `--rt-control-height` tall, `0.4rem 0.75rem`
  padding, never wrapping (`white-space: nowrap`).
- **Default:** `surface` ground, `border-strong` border, body text. The neutral majority.
- **Primary:** Signal Blue fill (`#2563eb`), white text, matching border;
  deepens to `#1d4ed8` on hover. One per view, at most.
- **Destructive:** white ground with a red border and red text (`#dc2626`),
  filling to `#fee2e2` on hover. Destructive actions are outlined, not filled —
  a solid red button is too easy to hit by accident on a touch screen.
- **Go / Stop (countdown only):** the two large 48px-tall filled buttons in the
  countdown dialog, green-700 and red-600, full-width on a phone. These are the
  only filled signal-coloured buttons in the app.
- **Focus:** `outline: 2px solid #2563eb` at `2px` offset on `:focus-visible`,
  on every interactive element without exception. The editor is driven from the
  keyboard as much as the mouse.

### Badges

- **Style:** 36px tall, 6px radius, `0 0.75rem` padding, a 2px border and a
  tinted ground, with an uppercase 0.75rem label beside the value.
- **Shown:** `#dcfce7` ground, `#16a34a` border, `#14532d` text.
- **Hidden:** `#fee2e2` ground, `#fca5a5` border, `#7f1d1d` text.
- **Time:** `#eef2ff` ground, `#6366f1` border, `#312e81` text.
- **Neutral:** `#f3f4f6` ground, `#e5e7eb` border, `#374151` text.

### Cards / Control Boards

- **Corner:** 8px. **Ground:** white on the page's `#fafafa`.
- **Border:** 1px `border` (`#e5e7eb`). **Shadow:** none at rest.
- **Padding:** `1rem`, with a `0.75rem` header rule above the content.

### Inputs

- **Style:** `surface` ground, 1px `border-strong` border, 4px radius, `0.35rem 0.5rem`
  padding, `font: inherit` so they never drift from the body face.
- **Labels:** 0.75rem uppercase, stacked above the field with a `0.2rem` gap.
- **Focus:** the same 2px blue outline as buttons.

### Timeline (signature component)

The run page's series view is the one component with real domain personality.
Events render as compact chips — duration, command and cumulative time on one
line — reflowing four to five per row on a phone. The active series takes a 2px
indigo border and a neutral lift; the active event takes an indigo ring.

There is a time-scaled mode as well, but proportional widths are the wrong
default on a phone: a 1-second event inside a 30-second series is 3.3% of the
width, which is 11px at 390px wide. Auto mode chooses chips at narrow widths
for that reason.

### Dialogs

- **Shape:** 12px radius, `min(90vw, 420px)` wide, no border, the Overlay
  shadow.
- **Backdrop:** `rgba(0, 0, 0, 0.5)` with a 2px blur.
- **Content:** centred column, `2rem` padding (`1.5rem` on a phone), `1rem` gap.

## Do's and Don'ts

### Do:

- **Do** write every colour as a `var(--rt-*)` token from `src/theme.css`. A
  literal hex in a component is a colour the dark theme cannot reach.
- **Do** pick the token by its job, not its hue: a red that is a fill is
  `stop`, a red that is text or a line is `stop-ink`. They match in light and
  part in dark.
- **Do** reserve green, red and amber for target shown, target hidden, and no
  delay armed. Anything else that needs colour uses indigo or a grey.
- **Do** put every interactive control at `var(--rt-control-height)` so mixed
  rows line up and touch targets stay at 44px on a phone.
- **Do** use `font-variant-numeric: tabular-nums` on any number that updates in
  place.
- **Do** give every focusable element a visible `:focus-visible` outline —
  2px solid `#2563eb`, 2px offset.
- **Do** check 4.5:1 contrast for text on any new coloured ground before
  shipping it. This system has already had ten failures found and fixed.
- **Do** give wide content (tables, timelines) its own scrollable wrapper
  rather than letting a layout container scroll.

### Don't:

- **Don't** put a thick coloured border on one side of a card.
- **Don't** put a resting shadow on a card. Use a border and a tone change.
- **Don't** tint a shadow to match its element's colour.
- **Don't** add `overflow-y: auto` to a flex layout container; it computes
  `overflow-x: auto` too and will clip content off the right edge.
- **Don't** put white text on green-600 (`#16a34a`) — 3.3:1. Use green-700.
- **Don't** introduce a fourth button style. There are four, and twelve files
  already redefine them; the next one should reuse, not add.
- **Don't** scale the countdown down on small screens. It is read from further
  away there, not closer.
