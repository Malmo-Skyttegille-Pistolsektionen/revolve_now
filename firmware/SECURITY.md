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

### The control lock is off after every boot

The control lock is opt-in and lives in RAM only, so a reboot returns the device to
the unprotected state. **Until a client enables it, every mutating endpoint is
open** — including `POST /api/v2/targets/show` and `POST /api/v2/programs/start`.

It is documented in [`docs/api-v2.md`](docs/api-v2.md#auth).

If that posture is not acceptable for a given deployment, the fix is to persist
the password in NVS and provision it out of band — a change to the contract in
[`../contracts/`](../contracts/README.md), the firmware and the webapp
together.

### First caller sets the password

While the control lock is off, `POST /api/v2/control-lock/enable` accepts any non-empty
password from an unauthenticated caller. Whoever calls first after a reboot
holds the only valid password until the device is power-cycled.

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
- `GET` endpoints, including `/api/v2/diagnostics/info`, are public. They carry
  no credential and no program data.
- **A coredump is served only while the configuration window is open.** It is
  a raw RAM snapshot and can contain the WiFi password in plaintext.
  `diagnostics/info` only reports whether one is present; `GET
  /api/v2/diagnostics/bundle` serves it, and refuses unless the BOOT-button
  gesture has opened the window — so retrieving it still needs someone at the
  board (D-39 in [`docs/DECISIONS.md`](../docs/DECISIONS.md)).
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
