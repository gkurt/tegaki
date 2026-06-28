/// <reference types="bun-types" />

/**
 * Web-component smoke test over the *CDN* path: loads `tegaki/wc` and a font
 * bundle from esm.sh at the published version (the same way the hyperframes
 * example consumes Tegaki), renders a `<tegaki-renderer>`, and asserts it
 * actually drew handwriting.
 *
 * This is distinct from the npm-install examples: it exercises esm.sh's built
 * output and the custom-element registration path. esm.sh builds packages on
 * first request, so a freshly published version 500s / serves a stub until the
 * build finishes — hence the extra readiness polling before we open a browser.
 *
 * Version comes from TEGAKI_VERSION (set by scripts/test-published-examples.ts),
 * defaulting to the `latest` dist-tag.
 *
 * Usage: TEGAKI_VERSION=0.19.0 bun run check-wc-cdn.ts
 */
import { chromium } from '@playwright/test';

const version = process.env.TEGAKI_VERSION || 'latest';
const esm = (p: string) => `https://esm.sh/tegaki@${version}${p}`;

// The subpaths the page imports. Each must be built and served by esm.sh before
// the browser can import it.
const ENTRIES = ['/wc', '/fonts/caveat'];

/** Fetch a built esm.sh module, following its first-level re-export targets. */
async function esmReady(entryPath: string): Promise<boolean> {
  const res = await fetch(esm(entryPath));
  if (!res.ok) return false;
  const body = await res.text();
  if (!/\b(export|import)\b/.test(body)) return false;
  // The entry re-exports the actual build, e.g. `export * from "/tegaki@x/es2022/wc.mjs"`.
  // Make sure that target is built too, not just the redirect stub.
  const targets = [...body.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const t of targets) {
    const url = t.startsWith('http') ? t : `https://esm.sh${t}`;
    const r = await fetch(url);
    if (!r.ok) return false;
  }
  return true;
}

async function waitForEsm(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (const entry of ENTRIES) {
    for (;;) {
      try {
        if (await esmReady(entry)) break;
      } catch {
        /* network blip — retry */
      }
      if (Date.now() > deadline) throw new Error(`esm.sh never served a built tegaki@${version}${entry}`);
      console.log(`Waiting for esm.sh to build tegaki@${version}${entry}...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const PAGE = (v: string) => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <tegaki-renderer id="t" text="Hi" time="100%" style="font-size:120px"></tegaki-renderer>
  <script type="module">
    const E = (p) => \`https://esm.sh/tegaki@${v}\${p}\`;
    try {
      const [wc, caveat] = await Promise.all([
        import(E('/wc')),
        import(E('/fonts/caveat')).then((m) => m.default),
      ]);
      wc.TegakiEngine.registerBundle(caveat);
      wc.registerTegakiElement();
      const el = document.getElementById('t');
      el.font = caveat;
      window.__wcOk = true;
    } catch (e) {
      window.__wcError = String((e && e.stack) || e);
    }
  </script>
</body></html>`;

/** Walk open shadow roots and report whether any canvas drew a non-transparent pixel. */
function pageHasInk(): boolean {
  const canvases: HTMLCanvasElement[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (el instanceof HTMLCanvasElement) canvases.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  for (const c of canvases) {
    const ctx = c.getContext('2d');
    if (!ctx || !c.width || !c.height) continue;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  }
  return false;
}

console.log(`Checking web-component over CDN (tegaki@${version} via esm.sh)...`);
await waitForEsm(180_000);

const server = Bun.serve({ port: 0, fetch: () => new Response(PAGE(version), { headers: { 'content-type': 'text/html' } }) });
const url = `http://127.0.0.1:${server.port}/`;
const browser = await chromium.launch();

try {
  let inked = false;
  let lastError = '';
  // esm.sh can still resolve a transient build error on a cold path; retry the
  // whole page load a few times before giving up.
  for (let attempt = 1; attempt <= 3 && !inked; attempt++) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(
        () => (window as { __wcOk?: boolean; __wcError?: string }).__wcOk || (window as { __wcError?: string }).__wcError,
        null,
        {
          timeout: 60_000,
        },
      );
      lastError = await page.evaluate(() => (window as { __wcError?: string }).__wcError || '');
      if (!lastError) {
        await page.waitForFunction(pageHasInk, null, { timeout: 30_000 }).catch(() => {});
        inked = await page.evaluate(pageHasInk);
      }
    } catch (e) {
      lastError = String(e);
    } finally {
      await page.close();
    }
    if (!inked && attempt < 3) {
      console.log(`Attempt ${attempt} failed (${lastError || 'no ink'}); retrying...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  if (!inked) {
    console.error(`✗ Web-component (CDN) did not render handwriting${lastError ? `: ${lastError}` : ''}`);
    process.exit(1);
  }
  console.log('✓ Web-component rendered handwriting from esm.sh');
} finally {
  await browser.close();
  server.stop(true);
}
