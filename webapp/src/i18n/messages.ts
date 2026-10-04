import type { en } from './en';

/** The shape of a dictionary: `en`'s, so a key cannot exist in one language only. */
export type Messages = typeof en;
