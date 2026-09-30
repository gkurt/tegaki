import { useEffect, useState } from 'react';
import {
  globalGradientPlugin,
  glowPlugin,
  registerPlugin,
  strokeGradientPlugin,
  type TegakiBundle,
  type TegakiPluginSpec,
  TegakiRenderer,
  type TimeControlProp,
  taperPlugin,
} from 'tegaki';

// The docs name the style plugins in MDX props (plain data), so register them here.
registerPlugin(glowPlugin, taperPlugin, strokeGradientPlugin, globalGradientPlugin);

type BundleImporter = () => Promise<{ default: TegakiBundle }>;

const FONT_IMPORTERS: Record<string, BundleImporter> = {
  caveat: () => import('tegaki/fonts/caveat') as unknown as Promise<{ default: TegakiBundle }>,
  italianno: () => import('tegaki/fonts/italianno') as unknown as Promise<{ default: TegakiBundle }>,
  tangerine: () => import('tegaki/fonts/tangerine') as unknown as Promise<{ default: TegakiBundle }>,
  parisienne: () => import('tegaki/fonts/parisienne') as unknown as Promise<{ default: TegakiBundle }>,
};

export interface LiveDemoProps {
  /** Text to render. */
  text?: string;
  /** Font bundle key (default: "caveat"). */
  fontKey?: string;
  /** Font size in px (default: 48). */
  fontSize?: number;
  /** Time control config. */
  time?: TimeControlProp;
  /** Plugins, by registered name (see the `registerPlugin` call above). */
  plugins?: readonly TegakiPluginSpec[];
  /** Caption shown below the demo. */
  caption?: string;
}

export function LiveDemo({
  text = 'Hello World',
  fontKey = 'caveat',
  fontSize = 48,
  time = { mode: 'uncontrolled', speed: 1, loop: true },
  plugins,
  caption,
}: LiveDemoProps) {
  const [bundle, setBundle] = useState<TegakiBundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    const importer = FONT_IMPORTERS[fontKey];
    if (!importer) return;
    importer().then((mod) => {
      if (!cancelled) setBundle(mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [fontKey]);

  return (
    <div className="not-content" style={{ marginTop: 16, marginBottom: 24 }}>
      <div
        style={{
          borderRadius: 12,
          border: '1px solid light-dark(#e5e7eb, #374151)',
          backgroundColor: 'light-dark(white, #1f2937)',
          padding: 24,
          minHeight: 72,
          boxShadow: 'light-dark(0 1px 2px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.3))',
        }}
      >
        {bundle ? (
          <TegakiRenderer font={bundle} time={time} plugins={plugins} style={{ fontSize }}>
            {text}
          </TegakiRenderer>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              fontSize: 14,
              color: 'light-dark(#9ca3af, #6b7280)',
            }}
          >
            Loading...
          </div>
        )}
      </div>
      {caption && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: 'light-dark(#6b7280, #9ca3af)',
            textAlign: 'center',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

export function LiveDemoControlled({ fontKey = 'caveat', fontSize = 48 }: { fontKey?: string; fontSize?: number }) {
  const [bundle, setBundle] = useState<TegakiBundle | null>(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const importer = FONT_IMPORTERS[fontKey];
    if (!importer) return;
    importer().then((mod) => {
      if (!cancelled) setBundle(mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [fontKey]);

  return (
    <div className="not-content" style={{ marginTop: 16, marginBottom: 24 }}>
      <div
        style={{
          borderRadius: 12,
          border: '1px solid light-dark(#e5e7eb, #374151)',
          backgroundColor: 'light-dark(white, #1f2937)',
          padding: 24,
          minHeight: 72,
          boxShadow: 'light-dark(0 1px 2px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.3))',
        }}
      >
        {bundle ? (
          <>
            <input
              type="range"
              min={0}
              max={10}
              step={0.01}
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
              style={{ width: '100%', marginBottom: 16 }}
            />
            <TegakiRenderer font={bundle} time={time} style={{ fontSize }}>
              Scrub me!
            </TegakiRenderer>
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              fontSize: 14,
              color: 'light-dark(#9ca3af, #6b7280)',
            }}
          >
            Loading...
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          color: 'light-dark(#6b7280, #9ca3af)',
          textAlign: 'center',
        }}
      >
        Drag the slider to scrub through the animation
      </div>
    </div>
  );
}
