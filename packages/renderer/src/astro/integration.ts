// Astro integration for `tegaki/astro`: font bundles whose font URLs work once
// the page is rendered on the server.
//
// A bundle points at its font with `new URL('./font.ttf', import.meta.url)`
// (built) or `import url from './font.ttf' with { type: 'url' }` (generated
// source). In the browser Vite turns either into a public asset URL, but not
// on the server: there the expression is evaluated as it stands, to a
// `file://` path on the build machine, and `tegaki/astro` — which serializes
// the bundle the server holds into the page — hands the browser a font it may
// not load (the strokes still draw, laid out in a fallback font's widths).
// This rewrites both forms in bundle modules to `?url` imports, which Vite
// emits as assets and resolves to their public URL on the server too.
//
//   // astro.config.mjs
//   import tegaki from 'tegaki/astro/integration';
//   export default defineConfig({ integrations: [tegaki()] });

import type { AstroIntegration } from 'astro';

const FONT = String.raw`\.{1,2}/[^'"\s]+\.(?:ttf|otf|woff2?)`;
const URL_ATTRIBUTE_IMPORT = new RegExp(
  String.raw`import\s+(\w+)\s+from\s+(['"])(${FONT})\2\s+with\s*\{\s*type\s*:\s*['"]url['"]\s*\}\s*;?`,
  'g',
);
const META_URL_HREF = new RegExp(String.raw`new\s+URL\(\s*(['"])(${FONT})\1\s*,\s*import\.meta\.url\s*\)\.href`, 'g');

/**
 * A Tegaki bundle module with its font URLs as `?url` asset imports, or null
 * when `code` is not a bundle or has none. Only bundles are touched: modules
 * that build a `fontFaceCSS`.
 */
export function rewriteBundleFontUrls(code: string): string | null {
  if (!code.includes('fontFaceCSS')) return null;
  const imports: string[] = [];
  let out = code.replace(URL_ATTRIBUTE_IMPORT, (_, name: string, _q: string, path: string) => `import ${name} from '${path}?url';`);
  out = out.replace(META_URL_HREF, (_, _q: string, path: string) => {
    const name = `__tegakiFontUrl${imports.length}`;
    imports.push(`import ${name} from '${path}?url';`);
    return name;
  });
  if (out === code) return null;
  return imports.length > 0 ? `${imports.join('\n')}\n${out}` : out;
}

/** The Vite plugin the integration adds: {@link rewriteBundleFontUrls} on the server only (the client needs no help). */
export function tegakiFontUrls() {
  return {
    name: 'tegaki:bundle-font-urls',
    enforce: 'pre' as const,
    transform(
      this: { environment?: { config: { consumer: string } } },
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ): { code: string; map: null } | null {
      const server = this.environment ? this.environment.config.consumer === 'server' : options?.ssr === true;
      if (!server || !/\.(?:[cm]?[jt]s)$/.test(id.split('?')[0]!)) return null;
      const rewritten = rewriteBundleFontUrls(code);
      return rewritten === null ? null : { code: rewritten, map: null };
    },
  };
}

/** The Astro integration: adds {@link tegakiFontUrls} to Vite. */
export default function tegaki(): AstroIntegration {
  return {
    name: 'tegaki',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [tegakiFontUrls()] } });
      },
    },
  };
}
