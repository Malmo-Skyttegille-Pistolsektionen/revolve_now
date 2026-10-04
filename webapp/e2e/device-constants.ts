/**
 * What the shipped QEMU image holds, kept free of `@playwright/test` so the
 * vitest contract suite (`test/mock-server/contract.test.ts`) can read it too.
 * `device.ts` re-exports both.
 */

/** The password every spec turns the control lock on with. See `resetDevice`. */
export const CONTROL_LOCK_PASSWORD = 'e2e-secret';

/**
 * The shipped image carries exactly these, one JSON file each. Sorted, because
 * every assertion on it sorts the ids it compares.
 *
 * 41 is "Fältträning, 4 mål", the four-bank example (#207): it lists and loads
 * on this one-bank device and is refused only at start, which is the whole
 * point of shipping it.
 */
export const SHIPPED_PROGRAM_IDS = [1, 2, 20, 40, 41, 50, 100, 101];
