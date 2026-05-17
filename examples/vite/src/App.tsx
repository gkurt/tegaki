import { useEffect, useRef, useState } from 'react';
import { TegakiEngine } from 'tegaki/core';
import amiriBundle from 'tegaki/fonts/amiri';
import bundle from 'tegaki/fonts/caveat';
import { TegakiRenderer } from 'tegaki/react';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
import { registerTegakiElement, type TegakiElement } from 'tegaki/wc';

registerTegakiElement();
TegakiEngine.registerShaper(harfbuzzShaper);

import './app.css';

export function App() {
  const [time, setTime] = useState(0);
  const wcRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = wcRef.current;
    if (!host) return;
    const el = document.createElement('tegaki-renderer') as TegakiElement;
    el.setAttribute('text', 'Web Component!');
    el.setAttribute('loop', '');
    el.style.fontSize = '56px';
    el.font = bundle;
    host.appendChild(el);
    return () => {
      host.removeChild(el);
    };
  }, []);

  return (
    <main className="page">
      <h1>Tegaki × Vite</h1>
      <p>
        Plain Vite + React app using the <code>tegaki/react</code> adapter and the <code>tegaki/wc</code> web component.
      </p>

      <section>
        <h2>Looping</h2>
        <TegakiRenderer font={bundle} time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }} style={{ fontSize: '64px' }}>
          Hello, Vite!
        </TegakiRenderer>
      </section>

      <section>
        <h2>Scrubbable</h2>
        <input type="range" min={0} max={8} step={0.01} value={time} onChange={(e) => setTime(Number(e.target.value))} />
        <TegakiRenderer font={bundle} time={time} style={{ fontSize: '48px' }}>
          Scrub me!
        </TegakiRenderer>
      </section>

      <section>
        <h2>With effects</h2>
        <TegakiRenderer
          font={bundle}
          time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }}
          effects={{
            glow: { radius: 8, color: '#00ccff' },
            pressureWidth: true,
            strokeGradient: { colors: 'rainbow' },
          }}
          style={{ fontSize: '56px' }}
        >
          Fancy!
        </TegakiRenderer>
      </section>

      <section>
        <h2>Shaper (Arabic, RTL)</h2>
        <p>
          Amiri rendered through the <code>tegaki/shaper-harfbuzz</code> shaper — the only path that produces correct Arabic positional
          forms (init / medi / fina / isol).
        </p>
        <TegakiRenderer
          font={amiriBundle}
          direction="rtl"
          time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }}
          style={{ fontSize: '56px' }}
        >
          الكتابة اليدوية رائعة
        </TegakiRenderer>
        <p style={{ marginTop: '1.5rem', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#6b7280' }}>
          Same text with <code>shaper={`{false}`}</code> — falls back to char-by-char lookup, so letters render in isolated form and never
          join:
        </p>
        <TegakiRenderer
          font={amiriBundle}
          direction="rtl"
          shaper={false}
          time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }}
          style={{ fontSize: '40px', opacity: 0.7 }}
        >
          الكتابة اليدوية رائعة
        </TegakiRenderer>
      </section>

      <section>
        <h2>Web Component adapter</h2>
        <p>
          Rendered via <code>&lt;tegaki-renderer&gt;</code> (registered from <code>tegaki/wc</code>), with the bundle assigned imperatively
          to the <code>.font</code> property.
        </p>
        <div ref={wcRef} />
      </section>
    </main>
  );
}
