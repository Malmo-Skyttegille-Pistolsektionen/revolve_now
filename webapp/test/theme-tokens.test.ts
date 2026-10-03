import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * DESIGN.md is the source of truth for colour and src/theme.css implements it
 * (#334). Nothing renders the cascade in a unit test, so these hold the three
 * text files to each other instead.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THEME = readFileSync(join(ROOT, 'src/theme.css'), 'utf-8');
const DESIGN = readFileSync(join(ROOT, 'DESIGN.md'), 'utf-8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--rt-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
}

const [lightBlock, rest] = THEME.split('@media (prefers-color-scheme: dark)');
const [mediaBlock, explicitBlock] = rest.split(":root[data-theme='dark']");
const light = tokens(lightBlock);
const darkFromOs = tokens(mediaBlock);
const darkExplicit = tokens(explicitBlock);

describe('theme tokens', () => {
  it('gives every light token a dark value', () => {
    expect(Object.keys(darkFromOs)).toEqual(Object.keys(light));
  });

  // The dark values are written twice, once per way of choosing dark. They
  // must not drift.
  it('keeps the OS-dark and explicit-dark blocks identical', () => {
    expect(darkExplicit).toEqual(darkFromOs);
  });

  it('matches the light palette in the DESIGN.md frontmatter', () => {
    const frontmatter = parse(DESIGN.split('---')[1]) as { colors: Record<string, string> };
    expect(frontmatter.colors).toEqual(light);
  });

  it('matches the dark column of the DESIGN.md table', () => {
    // Cells may be padded: Prettier aligns the table's columns.
    const rows = [...DESIGN.matchAll(/^\| `([a-z-]+)` +\| `(#[0-9a-f]{6})` +\| `(#[0-9a-f]{6})` +\|$/gm)];
    expect(Object.fromEntries(rows.map((m) => [m[1], m[2]]))).toEqual(light);
    expect(Object.fromEntries(rows.map((m) => [m[1], m[3]]))).toEqual(darkFromOs);
  });
});

describe('colour literals', () => {
  function cssFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return cssFiles(path);
      return entry.name.endsWith('.css') && entry.name !== 'theme.css' ? [path] : [];
    });
  }

  // A literal is a colour the dark theme cannot reach. Comments may still name
  // values; rgba() shadows are black at low alpha and read on either ground.
  it('uses a token for every colour outside theme.css', () => {
    const offenders = cssFiles(join(ROOT, 'src')).flatMap((file) =>
      readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        // Named colours too: `background-color: white` once left the
        // countdown's light digits on a white dialog in the dark theme.
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|:\s*(white|black)\s*(;|$)/.test(line))
        .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('references only tokens theme.css defines', () => {
    const defined = new Set([...Object.keys(light), 'control-height', 'nav-height']);
    const unknown = cssFiles(join(ROOT, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf-8').matchAll(/var\(--rt-([a-z-]+)\)/g)]
        .map((m) => m[1])
        .filter((name) => !defined.has(name))
        .map((name) => `${relative(ROOT, file)}: --rt-${name}`),
    );
    expect(unknown).toEqual([]);
  });
});
