// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProgramEditor } from '../src/components/ProgramEditor';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';

/** `ProgramEditor` calls `useBlocker()`, which needs a router in context. */
function renderEditor(): void {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <ProgramEditor
        target={{ kind: 'standalone', id: 42, document: null, origin: 'new', originLabel: 'ny' }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
});

afterEach(cleanup);

describe('the editor in Swedish', () => {
  it('renders its headings, buttons and labels from the sv dictionary', async () => {
    renderEditor();
    expect((await screen.findByTestId('editor-heading')).textContent).toBe('Program 42 (ingen enhet — ny)');
    expect(screen.getByTestId('editor-save').textContent).toBe('Fortsätt');
    expect(screen.getByTestId('editor-add-series').textContent).toBe('Lägg till serie');
    expect(screen.getByTestId('editor-banks-fewer').getAttribute('aria-label')).toBe('Färre tavelgrupper');
    expect(screen.getByRole('heading', { name: 'Förhandsvisning' })).toBeTruthy();
  });
});
