// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CountdownModal } from '../src/components/CountdownModal';
import { StartDelayControl } from '../src/components/StartDelayControl';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
});

afterEach(cleanup);

describe('run page in Swedish', () => {
  it('counts down in Swedish', () => {
    render(
      <SettingsProvider>
        <CountdownModal seconds={3} onCancel={() => {}} onStartNow={() => {}} />
      </SettingsProvider>,
    );
    expect(screen.getByText('Startar om...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Starta nu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeTruthy();
  });

  it('labels the start delay in Swedish', () => {
    render(
      <SettingsProvider>
        <StartDelayControl />
      </SettingsProvider>,
    );
    expect(screen.getByLabelText('Startfördröjning')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Ingen fördröjning' })).toBeTruthy();
  });
});
