import { useEffect, useState } from 'react';
import { type TegakiBundle, TegakiRenderer } from 'tegaki';
import { TegakiEngine } from 'tegaki/core';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
import { StaticChatDemo } from './StaticChatDemo.tsx';

// Register the harfbuzz shaper once at module load — required for fonts that
// rely on contextual/positional shaping (Amiri's Arabic init/medi/fina/isol,
// Caveat's `calt` chains, etc.). Without it, those bundles render the nominal
// glyphs and never reach the variant glyph data shipped with the bundle.
TegakiEngine.registerShaper(harfbuzzShaper);

type BundleEntry = { name: string; bundle: TegakiBundle | null };

const FONT_IMPORTS = {
  Caveat: () => import('tegaki/fonts/caveat'),
  Italianno: () => import('tegaki/fonts/italianno'),
  Tangerine: () => import('tegaki/fonts/tangerine'),
  Parisienne: () => import('tegaki/fonts/parisienne'),
  'Suez One': () => import('tegaki/fonts/suez-one'),
  Amiri: () => import('tegaki/fonts/amiri'),
  Tillana: () => import('tegaki/fonts/tillana'),
  'Klee One': () => import('tegaki/fonts/klee-one'),
} as const;

const FONT_NAMES = Object.keys(FONT_IMPORTS) as (keyof typeof FONT_IMPORTS)[];

const HERO_TEXT = 'Hello, World!';
const DEFAULT_SHOWCASE_TEXT = 'The quick brown fox';
/** Per-font showcase text — non-Latin bundles render their script's sample. */
const SHOWCASE_TEXTS: Partial<Record<keyof typeof FONT_IMPORTS, string>> = {
  'Suez One': 'כתב היד מדהים',
  Amiri: 'الكتابة اليدوية رائعة',
  Tillana: 'हस्तलेखन अद्भुत है',
  // Klee One ships only Kyōiku grade 1–2 kanji, so the standard "手書きは
  // 素晴らしい" doesn't work — `素` is grade 5. `楽` ("fun") is grade 2 and
  // gives a phrase that's just as natural to a Japanese reader.
  'Klee One': '手書きは楽しい',
};

function FontCard({ name, bundle, text }: { name: string; bundle: TegakiBundle | null; text: string }) {
  return (
    <div style={{ marginTop: 0 }}>
      <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500, color: 'light-dark(#6b7280, #9ca3af)', letterSpacing: '0.05em' }}>
        {name}
      </div>
      <div
        style={{
          borderRadius: 12,
          border: '1px solid light-dark(#e5e7eb, #374151)',
          backgroundColor: 'light-dark(white, #1f2937)',
          padding: 24,
          minHeight: 80,
          boxShadow: 'light-dark(0 1px 2px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.3))',
        }}
      >
        {bundle ? (
          <TegakiRenderer font={bundle} time={{ mode: 'uncontrolled', speed: 1, loop: true }} style={{ fontSize: 36 }}>
            {text}
          </TegakiRenderer>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'light-dark(#9ca3af, #6b7280)' }}>
            Loading font...
          </div>
        )}
      </div>
    </div>
  );
}

export function HomePageExamples() {
  const [fonts, setFonts] = useState<BundleEntry[]>(() => FONT_NAMES.map((name) => ({ name, bundle: null })));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: BundleEntry[] = [];
      for (const name of FONT_NAMES) {
        try {
          const mod = await FONT_IMPORTS[name]();
          const bundle = mod.default as unknown as TegakiBundle;
          entries.push({ name, bundle });
        } catch {
          entries.push({ name, bundle: null });
        }
      }
      if (!cancelled) setFonts(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const heroBundle = fonts.find((f) => f.name === 'Caveat')?.bundle;

  return (
    <div className="not-content" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Hero */}
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px 24px' }}>
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            borderRadius: 16,
            border: '1px solid light-dark(#e5e7eb, #374151)',
            backgroundColor: 'light-dark(white, #1f2937)',
            padding: 32,
            boxShadow: 'light-dark(0 4px 12px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.3))',
          }}
        >
          {heroBundle ? (
            <TegakiRenderer font={heroBundle} time={{ mode: 'uncontrolled', speed: 1, loop: true }} style={{ fontSize: 64 }}>
              {HERO_TEXT}
            </TegakiRenderer>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: 'light-dark(#9ca3af, #6b7280)' }}>
              Preparing animation...
            </div>
          )}
        </div>
      </section>

      {/* Font showcase */}
      <section style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: 'light-dark(#111827, #f3f4f6)', marginBottom: 24 }}>Built-in Fonts</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 24 }}>
          {fonts.map((f) => (
            <FontCard
              key={f.name}
              name={f.name}
              bundle={f.bundle}
              text={SHOWCASE_TEXTS[f.name as keyof typeof FONT_IMPORTS] ?? DEFAULT_SHOWCASE_TEXT}
            />
          ))}
        </div>
      </section>

      {/* Static chat demo */}
      <section style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: 'light-dark(#111827, #f3f4f6)', marginBottom: 24 }}>Chat Demo</h2>
        <p style={{ fontSize: 14, color: 'light-dark(#6b7280, #9ca3af)', marginBottom: 16 }}>
          Tegaki can animate text as it streams in — perfect for AI chat interfaces.
        </p>
        {heroBundle ? (
          <StaticChatDemo font={heroBundle} />
        ) : (
          <div style={{ color: 'light-dark(#9ca3af, #6b7280)', padding: 32 }}>Loading...</div>
        )}
      </section>
    </div>
  );
}
