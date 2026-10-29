# Security

## Reporting

Report anything security-relevant to the maintainers privately — open a
[security advisory](https://github.com/Malmo-Skyttegille-Pistolsektionen/revolve_now/security/advisories/new)
rather than a public issue.

**Never include WiFi credentials** in an issue, advisory, commit or any file
other than the gitignored `sdkconfig`.

## Threat model, stated plainly

This device sits on a club LAN and **controls physical targets that tell
shooters when to fire**. Unauthorised control is a safety concern, not just a
data one. It is not hardened against a determined attacker with network access,
and the following are known, deliberate properties rather than oversights.

### The control lock is opt-in

**Until somebody turns the control lock on, every mutating endpoint is open**
— including `POST /api/v2/targets/show` and `POST /api/v2/programs/start`. It
is documented in [`docs/api-v2.md`](docs/api-v2.md#auth).

Once on, it stays on across restarts (D-51): NVS holds a salted PBKDF2 hash of
the password, never the password, and sessions are RAM-only, so a restart logs
everybody out but unlocks nothing.

### Setting it needs somebody at the board

`POST /api/v2/control-lock/enable` accepts any non-empty password, but only
while the configuration window is open (three presses of BOOT), so a caller on
the network cannot claim the device. Somebody at the board can also turn the
lock off without the password, which is the way back from a forgotten one; a
factory reset clears it too. A build without a button cannot prove presence:
it sets the lock without the window, as before, and turns it off only with a
session.

### The configuration window belongs to one client

Three presses of BOOT open the configuration window for **the one client that
asked for it** (D-52, #656), not for the network. A client calls `POST
/api/v2/config-window/request` and gets a 16-byte random token; the presses
then grant the window to that token, and every window-gated route (the
troubleshooting bundle, hardware configuration, WiFi, the hardware part of a
restore, and the control lock's window paths) requires it in
`X-Config-Window`. Before this, the presses set one device-wide deadline, so
any LAN client could pull the coredump or change WiFi while somebody at the
board had the window open.

- **The presses are the last step.** With more than one request waiting they
  grant nobody, log it and show magenta on the LED; a single grant shows cyan.
  A client polling with its own requests can therefore turn the operator's
  presses into a conflict, and keep doing so while it stays on the network,
  but it cannot take the window over. At most four requests wait at once; a
  fifth is refused rather than pushing one out.
- **What it does not stop.** If the operator presses BOOT without having asked
  first, and another client's request is the only one waiting, that client is
  granted the window. The web app always asks before telling anyone to press.
- **What is still public.** The `configWindow` event and `GET
  /api/v2/config-window` say whether a window is open for *somebody*. Neither
  carries a token or anything a client can use without one.
- The token is its own header, never a cookie, so a cross-site form cannot
  carry it, and it is separate from the control lock's token. A build without
  a button still leaves the hardware routes open, as before.

### Other deliberate choices

- The `control_lock` cookie is **not** `HttpOnly` — the webapp reads it back. It is
  `SameSite=Lax`, so it is not sent on cross-site requests; a webapp on another
  origin uses the bearer token instead.
- Tokens are 16 bytes from `esp_fill_random()`, expire after 12 hours, and at
  most 8 sessions are held at once. Password and token comparisons are
  constant-time.
- CORS reflects the request `Origin` **only** if it matches the device's own
  mDNS name or IP, or `CONFIG_RT_DEV_ORIGIN`. Anything else gets no CORS
  headers.
- A write from a foreign `Origin` is refused (`403`), and so is any API request
  whose `Host` is not the device's name or an IP literal (`421`). The first
  closes cross-site form posts while the lock is off; the second, DNS
  rebinding. Responses refuse to be framed.
- `GET` endpoints, including `/api/v2/diagnostics/info`, are public. They carry
  no credential and no program data.
- **The setup network is not private.** Its password defaults to the public
  `revolvenow` (`CONFIG_RT_SETUP_AP_PASSWORD`), so a WiFi password typed into
  the portal can be read by anyone who captured the join. The BOOT press
  (#208) stops a takeover, not eavesdropping; the portal page and the
  connecting guide say so.
- **A coredump is served only to the client holding the configuration
  window.** It is a raw RAM snapshot and can contain the WiFi password in
  plaintext. `diagnostics/info` only reports whether one is present; `GET
  /api/v2/diagnostics/bundle` serves it, and refuses unless the BOOT-button
  gesture opened the window for this request's token — so retrieving it still
  needs someone at the board (D-39, D-52 in
  [`docs/DECISIONS.md`](../docs/DECISIONS.md)).
- Uploads are capped at 1 MB, streamed to a staging file, validated, and only
  then renamed to an id-derived name — a client-supplied filename never reaches
  the filesystem. A restore is the exception to the size: it carries the whole
  `userdata` partition, read entry by entry, and each entry goes through the
  same checks and the same id-derived naming an upload does.
- **A backup never holds the WiFi credentials** (D-48). `GET
  /api/v2/backup` is public like every other `GET`: the programs, clips and
  hardware configuration in it are already readable one by one.

## What is tested

The parsers that take untrusted input — WAV headers, URI path ids, program
documents, filenames and backup archives — live in `lib/rt_logic/` and are covered by
`host_test/`, which CI runs under **ASan and UBSan** on every push. That is
deliberate: in `main/`, behind a `FILE*` or an HTTP request, no test and no
sanitizer can reach them.
