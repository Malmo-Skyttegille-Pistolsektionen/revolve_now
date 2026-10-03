/**
 * Regenerates the web app screenshots in docs/site/img/ against the mock
 * server, so no board is needed: `npm run screenshots`. Run it after a UI
 * change and commit the images that changed.
 *
 * setup-portal.png is not produced here; the portal is served by the firmware.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer, type PluginOption, type ViteDevServer } from 'vite';
import viteConfig from '../vite.config';
import { mockServerV2Plugin } from '../vite-plugins/mock-server-v2';
import { resolveVersion } from '../vite-plugins/resolve-version';
import { createMockServer, loadSeedFromDisk, type MockServer } from '../test/mock-server/server';

const webappDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = path.resolve(webappDir, '../docs/site/img');

let server: ViteDevServer;
let mock: MockServer;
let base: string;

/** The config's own mock plugin is swapped for one seeded to look like a board on a club network. */
function withoutDefaultMock(options: PluginOption[]): PluginOption[] {
  return options.map((o) => {
    if (Array.isArray(o)) return withoutDefaultMock(o);
    if (o && 'name' in o && o.name === 'mock-server-v2') return false;
    return o;
  });
}

test.beforeAll(async () => {
  const seed = {
    ...loadSeedFromDisk(),
    // Matching the bundle's version keeps the "built from a different commit" warning off Settings.
    firmwareVersion: resolveVersion(),
    ipAddress: '192.168.1.50',
    wifi: { ipAddress: '192.168.1.50' },
    configWindowOpen: false,
  };
  server = await createServer({
    ...viteConfig,
    configFile: false,
    root: webappDir,
    logLevel: 'warn',
    server: { host: 'localhost', port: 0 },
    plugins: [
      ...withoutDefaultMock(viteConfig.plugins ?? []),
      mockServerV2Plugin(() => (mock = createMockServer({ seed }))),
    ],
  });
  await server.listen();
  base = server.resolvedUrls!.local[0].replace(/\/$/, '');
});

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(() => {
  mock.reset();
});

async function open(page: Page, route: string, ready: Locator, origin = base): Promise<void> {
  await page.goto(`${origin}${route}`);
  await ready.waitFor();
  await page.addStyleTag({ content: 'footer.TanStackRouterDevtools { display: none !important; }' });
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  // Let SSE-driven badges and fonts settle.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(imgDir, name), fullPage });
}

async function loadProgram(page: Page, title: string): Promise<void> {
  await open(page, '/run', page.getByRole('button', { name: 'Start', exact: true }));
  const picker = page.locator('select').first();
  await picker.selectOption({ label: title });
  await expect(picker.locator('option:checked')).toHaveText(`${title} (Loaded)`);
}

// Through the countdown dialog rather than "No delay", which leaves the delay control highlighted.
async function startNow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Start Now' }).click();
  // Off the event cards, whose hover opens a details panel.
  await page.mouse.move(0, 0);
}

test('run page', async ({ page }) => {
  await open(page, '/run', page.getByRole('button', { name: 'Start', exact: true }));
  const controls = await page.getByRole('button', { name: 'Toggle Targets' }).boundingBox();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(imgDir, 'run-idle.png'),
    clip: { x: 0, y: 0, width: 1100, height: controls!.y + controls!.height + 40 },
  });

  await loadProgram(page, 'Militär Snabbmatch');
  await shoot(page, 'run-loaded.png');

  await startNow(page);
  // Into the loading minute, event 2.
  await page.waitForTimeout(7_000);
  await shoot(page, 'run-running.png');
});

test('run page on a phone', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  await loadProgram(page, 'Militär Snabbmatch');
  await startNow(page);
  await page.waitForTimeout(7_000);
  await shoot(page, 'run-phone.png');
  await page.close();
});

test('tutorial program', async ({ page, request }) => {
  // The program docs/site/writing-a-program.md builds: the first two series of
  // Militär Snabbmatch, with the clock anchored on the shooting.
  const shipped = (await (await request.get(`${base}/api/v2/programs/1`)).json()) as {
    series: Record<string, unknown>[];
  };
  const created = await request.post(`${base}/api/v2/programs`, {
    data: {
      title: 'Militär Snabbmatch (kort)',
      description: 'Provserie 10s + Serie 1, 10s',
      series: shipped.series.slice(0, 2).map((s) => ({ ...s, timer_start_index: 3 })),
    },
  });
  if (!created.ok()) throw new Error(`creating the tutorial program: ${created.status()}`);

  // Tall enough that the page never scrolls to follow the run, which would bring in the compact header.
  await page.setViewportSize({ width: 1100, height: 880 });
  await loadProgram(page, 'Militär Snabbmatch (kort)');
  await startNow(page);
  await page.waitForTimeout(5_000);
  await shoot(page, 'tutorial-countdown.png');
  // Two seconds into the ten-second string, which starts at 72 s.
  await page.waitForTimeout(69_000);
  await shoot(page, 'tutorial-shooting.png');
});

test('library pages', async ({ page }) => {
  await open(page, '/programs', page.getByRole('heading', { name: 'Programs' }));
  await page.setViewportSize({ width: 1100, height: 640 });
  await shoot(page, 'programs.png', true);

  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page, '/audios', page.getByRole('heading', { name: 'Audios', exact: true }));
  await shoot(page, 'audios.png');
});

test('settings and expert mode', async ({ page }) => {
  // Settings shows the page's own origin as the server URL; give it the device's.
  const device = 'http://rotation-target.local';
  await page.route(`${device}/**`, (route) => route.continue({ url: route.request().url().replace(device, base) }));
  await open(page, '/settings', page.getByRole('heading', { name: 'Settings' }), device);
  await shoot(page, 'settings.png', true);

  mock.setConfigWindow(true);
  await open(page, '/hardware', page.getByRole('heading', { name: 'Expert mode' }), device);
  await shoot(page, 'expert-mode.png');
});
