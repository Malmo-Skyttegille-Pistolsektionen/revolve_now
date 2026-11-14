import type { Messages } from '../messages';
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

export const sv: Messages = {
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
