import { createSignal } from 'solid-js';
import bundle from 'tegaki/fonts/caveat';
import { TegakiRenderer } from 'tegaki/solid';

export function App() {
  const [time, setTime] = createSignal(8);

  return (
    <main class="page">
      <h1>Tegaki × Solid</h1>
      <p>
        Vite + SolidJS app using the <code>tegaki/solid</code> adapter.
      </p>

      <section id="looping">
        <h2>Looping</h2>
        <TegakiRenderer
          font={bundle}
          text="Hello, Solid!"
          time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }}
          style={{ 'font-size': '64px' }}
        />
      </section>

      <section id="scrubbable">
        <h2>Scrubbable</h2>
        <input type="range" min={0} max={8} step={0.01} value={time()} onInput={(e) => setTime(Number(e.currentTarget.value))} />
        <TegakiRenderer font={bundle} text="Scrub me!" time={time()} style={{ 'font-size': '48px' }} />
      </section>
    </main>
  );
}
