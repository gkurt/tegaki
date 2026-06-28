import { TegakiRenderer } from 'tegaki';
import bundle from 'tegaki/fonts/caveat';
import { ScrubDemo } from './demo';

export default function Home() {
  return (
    <main className="page">
      <h1>Tegaki × Next.js</h1>
      <p>
        Next.js App Router app using the <code>tegaki</code> React adapter. In Next.js 16 <strong>Turbopack is the default bundler</strong>{' '}
        for both <code>next dev</code> and <code>next build</code>, so this page exercises Tegaki under Turbopack.
      </p>

      <section>
        <h2>Looping</h2>
        <TegakiRenderer font={bundle} time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }} style={{ fontSize: '64px' }}>
          Hello, Next.js!
        </TegakiRenderer>
      </section>

      <section>
        <h2>Scrubbable (client state)</h2>
        <ScrubDemo />
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
    </main>
  );
}
