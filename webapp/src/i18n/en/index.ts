import { audios } from './audios';
import { common } from './common';
import { editor } from './editor';
import { hardware } from './hardware';
import { language } from './language';
import { nav } from './nav';
import { programs } from './programs';
import { run } from './run';
import { settings } from './settings';
import { standalone } from './standalone';

/**
 * The source language. Every other dictionary is typed from this one, so a
 * string added here without its translation fails `tsc`, and a translation
 * nobody uses any more fails the same way.
 *
 * One file per area of the app; a string lives with the area that shows it.
 */
export const en = {
  common,
  nav,
  language,
  settings,
  run,
  programs,
  editor,
  audios,
  hardware,
  standalone,
};
