import { defineConfig, devices } from '@playwright/test';

/** `npm run screenshots`: regenerates the images in docs/site/img/. Not a test suite; nothing asserts. */
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  // One dev server and one mock, shared by every shot.
  workers: 1,
  fullyParallel: false,
  // The tutorial shots wait out 74 s of a real-time run.
  timeout: 120_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 },
});
