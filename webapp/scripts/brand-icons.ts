// Derives every committed icon from the two masters in public/ (#438): the
// symbol, revolve-now.svg, and the logo, revolve-now-logo.svg. Run it after
// editing either: `npm run icons`. Rasterises with Playwright's Chromium, which
// the e2e tests already install.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

const at = (path: string) => new URL(path, import.meta.url);
const symbol = readFileSync(at('../public/revolve-now.svg'), 'utf8');
const logo = readFileSync(at('../public/revolve-now-logo.svg'), 'utf8');

/** A master with its theme-aware fill swapped for one fixed colour. */
const filled = (fill: string, master = symbol) =>
  master.replace(/<style>[\s\S]*?<\/style>/, `<style>.mark { fill: ${fill} }</style>`);

const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg: string, size: number, mark = size, ground = 'transparent'): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  const src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;height:${size}px;background:${ground}">` +
      `<img src="${src}" width="${mark}" height="${mark}"></body>`,
  );
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  return page.screenshot({ omitBackground: ground === 'transparent' });
}

/** An ICO is a directory of embedded PNGs. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

// A browser that cannot read the SVG favicon gets one grey that reads on a light
// and a dark tab bar alike (gray-500).
const grey = filled('#6b7280');
const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, data: await png(grey, size) }); // one page, so one at a time
writeFileSync(at('../public/favicon.ico'), ico(frames));

// iOS draws a home-screen icon on its own rounded square and needs it opaque.
writeFileSync(at('../public/apple-touch-icon.png'), await png(filled('#374151'), 180, 128, '#ffffff'));

// The docs site cannot reach webapp/public, so it gets copies. Its header is
// the Material primary colour in both schemes, hence a white symbol; the logo
// comes as a pair for #only-light/#only-dark, which follow the site's own
// scheme toggle where the master's media query follows only the OS.
writeFileSync(at('../../docs/site/img/revolve-now.svg'), symbol);
writeFileSync(at('../../docs/site/img/revolve-now-header.svg'), filled('#ffffff'));
writeFileSync(at('../../docs/site/img/revolve-now-logo-light.svg'), filled('#374151', logo));
writeFileSync(at('../../docs/site/img/revolve-now-logo-dark.svg'), filled('#d1d5db', logo));

await browser.close();
