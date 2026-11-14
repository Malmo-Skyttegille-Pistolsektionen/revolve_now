## What & Why

<!-- What changes, and the reason. The argument belongs here rather than in the source. -->

## Verified

<!-- Say what you actually ran, and be explicit about what you did NOT verify.
     "Compile-verified only, no hardware" is a fine answer; silence is not. -->

- [ ] `ctest` in `host_test/` passes
- [ ] `ctest` passes under `-DRT_SANITIZE=ON` (ASan + UBSan)
- [ ] `idf.py build` clean
- [ ] `pre-commit run --all-files` clean
- [ ] Verified on hardware — if not, say so below

## Range safety

<!-- Delete this section if the change cannot affect target or audio behaviour. -->

- [ ] Target position semantics unchanged, or [`docs/api-v2.md`](../firmware/docs/api-v2.md) updated to match
- [ ] Run-loop timing guarantees unchanged
- [ ] Host tests pin down any changed run behaviour

## Contract

- [ ] No API change, or [`contracts/`](../contracts/README.md) updated in this PR (and `npm run generate:api` re-run in `webapp/`)
- [ ] Run behaviour unchanged, or the mock server (`webapp/test/mock-server/server.ts`) changed with it
- [ ] [`docs/api-v2.md`](../firmware/docs/api-v2.md) still true of the change

## Web app

<!-- Delete this section if the change does not touch webapp/. -->

- [ ] `npm run test` and `npm run lint` pass in `webapp/`
- [ ] `npm run build` run before any firmware build that is meant to carry this change
