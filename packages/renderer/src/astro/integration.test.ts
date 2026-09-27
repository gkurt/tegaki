import { describe, expect, test } from 'bun:test';
import { rewriteBundleFontUrls, tegakiFontUrls } from './integration.ts';

// The two forms a bundle points at its font in: the generator's bundle.ts and tsdown's build of it.
const SOURCE = `import fontUrl from './caveat-3dc76002.ttf' with { type: 'url' };
import fullFontUrl from './caveat.ttf' with { type: 'url' };
import glyphData from './glyphData.json' with { type: 'json' };
const bundle = { fontUrl, fullFontUrl, fontFaceCSS: \`src: url(\${fontUrl})\`, glyphData };`;
const BUILT = `const fontUrl = new URL("./caveat-3dc76002.ttf", import.meta.url).href;
const fullFontUrl = new URL("./caveat.ttf", import.meta.url).href;
const bundle = { fontUrl, fullFontUrl, fontFaceCSS: \`src: url(\${fontUrl})\` };`;

describe('rewriteBundleFontUrls', () => {
  test("a generated bundle's url-attribute font imports become ?url imports", () => {
    const out = rewriteBundleFontUrls(SOURCE)!;
    expect(out).toContain("import fontUrl from './caveat-3dc76002.ttf?url';");
    expect(out).toContain("import fullFontUrl from './caveat.ttf?url';");
    // Only fonts: the JSON import keeps its attribute.
    expect(out).toContain("import glyphData from './glyphData.json' with { type: 'json' };");
  });

  test("a built bundle's new URL(…, import.meta.url).href becomes an imported asset URL", () => {
    const out = rewriteBundleFontUrls(BUILT)!;
    expect(out).toContain("import __tegakiFontUrl0 from './caveat-3dc76002.ttf?url';");
    expect(out).toContain("import __tegakiFontUrl1 from './caveat.ttf?url';");
    expect(out).toContain('const fontUrl = __tegakiFontUrl0;');
    expect(out).toContain('const fullFontUrl = __tegakiFontUrl1;');
    expect(out).not.toContain('import.meta.url');
  });

  test('modules that are not bundles are left alone', () => {
    expect(rewriteBundleFontUrls(`const u = new URL('./font.ttf', import.meta.url).href;`)).toBeNull();
  });

  test('a bundle with no font URLs is left alone', () => {
    expect(rewriteBundleFontUrls('const bundle = { fontFaceCSS: "" };')).toBeNull();
  });
});

describe('tegakiFontUrls', () => {
  const plugin = tegakiFontUrls();
  const run = (consumer: string, id = '/x/fonts/caveat/bundle.mjs') =>
    plugin.transform.call({ environment: { config: { consumer } } }, BUILT, id);

  test('rewrites on the server, where Vite leaves new URL(…, import.meta.url) as it stands', () => {
    expect(run('server')?.code).toContain('__tegakiFontUrl0');
  });

  test('leaves the client to Vite, which resolves the URLs itself', () => {
    expect(run('client')).toBeNull();
  });

  test('only transforms script modules', () => {
    expect(run('server', '/x/fonts/caveat/caveat.ttf?url')).toBeNull();
  });
});
