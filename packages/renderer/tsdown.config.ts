import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import { defineConfig } from 'tsdown';

const configDir = dirname(fileURLToPath(import.meta.url));

// Matches a leading `'use client'` / `"use client"` directive prologue.
const USE_CLIENT_RE = /^\s*(['"])use client\1\s*;?/;

/**
 * Rolldown treeshakes the bare `'use client'` directive string out of bundled
 * output (it reads as a side-effect-free expression statement), which strips
 * the React Server Component boundary the source files declare. Without it,
 * importing `tegaki`'s React adapter into a Next.js App Router Server Component
 * fails ("You're importing a module that depends on `useState`...").
 *
 * This plugin records which source modules carried the directive, then
 * re-prepends it to any output chunk built from one of them.
 */
function preserveUseClientPlugin() {
  const clientModules = new Set<string>();
  return {
    name: 'tegaki-preserve-use-client',
    transform(code: string, id: string) {
      if (USE_CLIENT_RE.test(code)) clientModules.add(id);
      return null;
    },
    renderChunk(code: string, chunk: { moduleIds: string[] }) {
      if (USE_CLIENT_RE.test(code)) return null; // already present
      if (!chunk.moduleIds.some((id) => clientModules.has(id))) return null;
      const s = new MagicString(code);
      s.prepend("'use client';\n");
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}

/**
 * Rolldown plugin that transforms font bundle source files so the built output
 * works natively in browsers and on CDNs (no bundler-specific import attributes).
 *
 * - `import fontUrl from './X.ttf' with { type: 'url' }` →
 *   `const fontUrl = new URL('./X.ttf', import.meta.url).href`
 *
 * - `import glyphData from './X.json' with { type: 'json' }` →
 *   inlined JSON object
 */
function fontBundlePlugin() {
  return {
    name: 'tegaki-font-bundle',
    transform(code: string, id: string) {
      if (!id.includes('/fonts/') || !id.endsWith('bundle.ts')) return;

      let result = code;

      // Transform: import fontUrl from './X.ttf' with { type: 'url' }
      // →  const fontUrl = new URL('./X.ttf', import.meta.url).href
      result = result.replace(
        /import\s+(\w+)\s+from\s+['"](\.\/[^'"]+\.ttf)['"]\s+with\s+\{[^}]*\}\s*;/g,
        (_match: string, name: string, path: string) => `const ${name} = new URL('${path}', import.meta.url).href;`,
      );

      // Transform: import glyphData from './X.json' with { type: 'json' }
      // → inline the JSON content
      result = result.replace(
        /import\s+(\w+)\s+from\s+['"](\.\/[^'"]+\.json)['"]\s+with\s+\{[^}]*\}\s*;/g,
        (_match: string, name: string, jsonPath: string) => {
          const fullPath = resolve(dirname(id), jsonPath);
          const json = readFileSync(fullPath, 'utf-8');
          return `const ${name} = ${json.trim()};`;
        },
      );

      if (result !== code) {
        return { code: result };
      }
    },
    writeBundle() {
      // Copy .ttf files next to built bundles so import.meta.url references resolve
      const fonts = [
        'caveat',
        'italianno',
        'tangerine',
        'parisienne',
        'suez-one',
        'amiri',
        'klee-one',
        'tillana',
        'nanum-pen-script',
        'atma',
      ];
      for (const font of fonts) {
        const srcDir = resolve(configDir, 'fonts', font);
        const destDir = resolve(configDir, 'dist', 'fonts', font);
        mkdirSync(destDir, { recursive: true });
        for (const file of readdirSync(srcDir)) {
          if (file.endsWith('.ttf')) {
            copyFileSync(resolve(srcDir, file), resolve(destDir, file));
          }
        }
      }
    },
  };
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    // Solid is shipped as source (compiled by the consumer's solid plugin via
    // the `solid` export condition) — tsdown/rolldown can't run babel-preset-solid,
    // so a prebuilt dist emits an invalid `solid-js/jsx-runtime` import. See ./package.json.
    'wc/index': 'src/wc/index.ts',
    'shaper-harfbuzz/index': 'src/shaper-harfbuzz/index.ts',
    'fonts/caveat/bundle': 'fonts/caveat/bundle.ts',
    'fonts/italianno/bundle': 'fonts/italianno/bundle.ts',
    'fonts/tangerine/bundle': 'fonts/tangerine/bundle.ts',
    'fonts/parisienne/bundle': 'fonts/parisienne/bundle.ts',
    'fonts/suez-one/bundle': 'fonts/suez-one/bundle.ts',
    'fonts/amiri/bundle': 'fonts/amiri/bundle.ts',
    'fonts/klee-one/bundle': 'fonts/klee-one/bundle.ts',
    'fonts/tillana/bundle': 'fonts/tillana/bundle.ts',
    'fonts/nanum-pen-script/bundle': 'fonts/nanum-pen-script/bundle.ts',
    'fonts/atma/bundle': 'fonts/atma/bundle.ts',
  },
  dts: true,
  sourcemap: true,
  plugins: [fontBundlePlugin(), preserveUseClientPlugin()],
});
