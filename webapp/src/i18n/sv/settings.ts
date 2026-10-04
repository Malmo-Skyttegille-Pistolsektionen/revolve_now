import type { Messages } from '../messages';

export const settings: Messages['settings'] = {
  title: 'Inställningar',
  theme: {
    title: 'Tema',
    options: {
      system: 'System',
      light: 'Ljust',
      dark: 'Mörkt',
    },
    hint: 'System följer den här telefonens eller datorns eget ljusa eller mörka läge. Sparas bara i den här webbläsaren, precis som serveradressen.',
  },
};
