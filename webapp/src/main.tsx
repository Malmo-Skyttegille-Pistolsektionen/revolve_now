import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { useSSE } from './hooks/useSSE';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { updateBaseUrl } from './api/client';
import { applyTheme, readStoredTheme } from './lib/theme';
import { applyLanguage, readStoredLanguagePreference, resolveLanguage } from './i18n/language';
import './index.css';

// Before the first render, so an explicit choice that differs from the OS does
// not flash the other theme while React mounts.
applyTheme(readStoredTheme());
applyLanguage(resolveLanguage(readStoredLanguagePreference()));

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // Data is fresh for 1 minute by default
    },
  },
});

function App() {
  const { settings } = useSettings();

  // The one place the configured server URL reaches the API client: at
  // startup, so a stored URL applies from the first render, and on every change
  // (Settings only writes the setting).
  //
  // Runs before useSSE so the stream picks up the same URL on this render.
  useEffect(() => {
    updateBaseUrl(settings.serverBaseUrl);
  }, [settings.serverBaseUrl]);

  // Initialize SSE connection globally
  useSSE();
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
