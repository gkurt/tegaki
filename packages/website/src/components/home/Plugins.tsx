import { type CSSProperties, Fragment, type ReactNode, useMemo, useRef } from 'react';
import { TegakiRenderer } from 'tegaki';
import { annotatePlugin, type TegakiPlugin, type TegakiQuality, textPathPlugin, variationPlugin } from 'tegaki/core';
import { REPO_URL } from '../../site.ts';
import { burnPlugin } from '../plugins/burn.ts';
import { colorsPlugin } from '../plugins/colors.ts';
import { foilPlugin } from '../plugins/foil.ts';
import { ink3dPlugin } from '../plugins/ink3d.ts';
import { neonPlugin } from '../plugins/neon.ts';
import { paperPlugin } from '../plugins/paper.ts';
import { penPlugin } from '../plugins/pen.ts';
import { sprayPlugin } from '../plugins/spray.ts';
import { stitchPlugin } from '../plugins/stitch.ts';
import { strokeOrderPlugin } from '../plugins/stroke-order.ts';
import { wetPlugin } from '../plugins/wet.ts';
import { rainbow } from './rainbow.ts';
import { type FontName, useFont, useInView } from './shared.ts';

/** A plugin a card runs: its name, as the caption lists it, and its source on GitHub. */
interface Use {
  name: string;
  href: string;
}

/** A Studio demo plugin, from its file in components/plugins. */
const demo = (name: string, file = name): Use => ({
  name,
  href: `${REPO_URL}/blob/main/packages/website/src/components/plugins/${file}.ts`,
});
/** A plugin shipped in `tegaki/core`. */
const core = (name: string): Use => ({ name, href: `${REPO_URL}/blob/main/packages/renderer/src/plugins/${name}.ts` });

interface Showpiece {
  id: string;
  title: string;
  /** The plugins it runs, as the caption lists them. */
  uses: Use[];
  font: FontName;
  lang?: string;
  text: string;
  /** CSS font size. */
  size: string;
  /** Made once per card, so their caches last the card's life. */
  plugins: () => TegakiPlugin[];
  /**
   * Seconds a pass takes — the writing, then the time its plugins take to
   * settle after the pen (drying, cooling, smoke) — and to hold it after.
   */
  duration: number;
  hold?: number;
  quality?: TegakiQuality;
  /** Scenery around the writing: a hoop, tape, printed words. */
  scene?: ReactNode;
  /** Drawn in the writing's cell, centered on it. */
  mark?: ReactNode;
}

// Each card is a fixed material — its own surface and ink in both themes — so
// colors are literal, not the page's.
const SHOWPIECES: Showpiece[] = [
  {
    id: 'neon',
    title: 'Neon',
    uses: [demo('neon')],
    font: 'Parisienne',
    text: 'Stay up late',
    size: 'clamp(54px, 7vw, 104px)',
    plugins: () => [neonPlugin({ color: '#ff3d8b', faulty: 0.25 })],
    duration: 4,
    hold: 6,
  },
  {
    id: 'stitch',
    title: 'Embroidery',
    uses: [demo('colors'), demo('stitch')],
    font: 'Caveat',
    text: 'home sweet\nhome',
    size: 'clamp(42px, 4.6vw, 64px)',
    plugins: () => [
      colorsPlugin({ palette: 'crayon', by: 'glyph' }),
      stitchPlugin({ style: 'satin', density: 0.75, size: 1.3, linen: false }),
    ],
    duration: 4.4,
    hold: 3.5,
    scene: <span className="plug-hoop-screw" aria-hidden="true" />,
  },
  {
    id: 'order',
    title: 'Stroke order',
    uses: [demo('paper'), demo('order', 'stroke-order')],
    font: 'LXGW WenKai',
    lang: 'zh-Hans',
    text: '永',
    size: 'clamp(150px, 15vw, 200px)',
    plugins: () => [paperPlugin({ style: 'mi', color: '#d33a26', opacity: 0.45 }), strokeOrderPlugin({ accent: '#d33a26' })],
    duration: 4,
    hold: 3,
  },
  {
    id: 'foil',
    title: 'Gold foil',
    uses: [demo('foil')],
    font: 'Italianno',
    text: 'Save the date',
    size: 'clamp(58px, 6vw, 84px)',
    plugins: () => [foilPlugin({ metal: 'gold', shine: 0.9 })],
    duration: 3.4,
    hold: 4,
    scene: (
      <>
        <span className="plug-foil-top" aria-hidden="true">
          together with their families
        </span>
        <span className="plug-foil-bottom" aria-hidden="true">
          the fourteenth of june · kyoto
        </span>
      </>
    ),
  },
  {
    id: 'annotate',
    title: 'Annotate',
    uses: [core('annotate')],
    font: 'Caveat',
    text: "don't forget\nthe milk!",
    size: 'clamp(40px, 4vw, 54px)',
    plugins: () => [annotatePlugin({ mark: 'circle', target: 'words', pick: 4, color: '#d33a26', width: 0.05, roughness: 0.6 })],
    duration: 2.6,
    hold: 3,
    scene: <span className="plug-tape" aria-hidden="true" />,
  },
  {
    id: 'burn',
    title: 'Burn',
    uses: [demo('burn')],
    font: 'Caveat',
    text: 'burn after\nreading',
    size: 'clamp(46px, 5vw, 70px)',
    plugins: () => [burnPlugin({ cool: 1.8, scorch: 0.7, smoke: 0.6 })],
    duration: 5.8,
    hold: 1.5,
  },
  {
    id: 'spray',
    title: 'Spray paint',
    uses: [demo('spray')],
    font: 'Caveat',
    text: 'stay wild',
    size: 'clamp(76px, 9vw, 132px)',
    plugins: () => [sprayPlugin({ size: 1.6, haze: 0.7, drips: 0.9, run: 1.6 })],
    duration: 4,
    hold: 2,
  },
  {
    id: 'path',
    title: 'Text on a path',
    uses: [core('textPath')],
    font: 'Caveat',
    text: 'WRITTEN BY HAND - IN ANY FONT - STROKE BY STROKE - ',
    size: 'clamp(22px, 2vw, 27px)',
    plugins: () => [textPathPlugin({ shape: 'arc', angle: 360 })],
    duration: 5,
    hold: 3,
    mark: (
      <span className="plug-stamp-mark" lang="ja" aria-hidden="true">
        手
      </span>
    ),
  },
  {
    id: 'quill',
    title: 'Quill & wet ink',
    uses: [core('variation'), demo('wet'), demo('pen')],
    font: 'Italianno',
    text: 'With love, always',
    size: 'clamp(60px, 7vw, 100px)',
    plugins: () => [
      variationPlugin({ amount: 1.2 }),
      wetPlugin({ dry: 1.5, sheen: 0.7, pool: 0.5 }),
      penPlugin({ tool: 'quill', size: 1.4, lift: 0.22 }),
    ],
    duration: 6.5,
    hold: 1.5,
  },
  {
    id: 'ink3d',
    title: '3D ink',
    uses: [demo('colors'), demo('ink3d')],
    font: 'Caveat',
    text: 'Happy birthday!',
    size: 'clamp(56px, 8vw, 124px)',
    // Colors picks each letter's balloon; 3D ink blows it up with Three.js, loaded as the card attaches.
    plugins: () => [
      colorsPlugin({ palette: 'sunset', by: 'glyph' }),
      ink3dPlugin({ ...ink3dPlugin.presets.Balloon, own: false, tilt: 16, turn: -14, sway: 10, lift: 0.22 }),
    ],
    duration: 3.6,
    hold: 6,
  },
];

function ShowpieceCard({ piece }: { piece: Showpiece }) {
  const ref = useRef<HTMLElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '400px 0px' });
  const visible = useInView(ref);
  const font = useFont(near ? piece.font : null);
  const plugins = useMemo(piece.plugins, []);

  return (
    <figure ref={ref} className={`plug plug-${piece.id}`}>
      {piece.scene}
      <div className="plug-ink" lang={piece.lang} style={{ '--size': piece.size } as CSSProperties}>
        {piece.mark}
        {font && (
          <TegakiRenderer
            font={font}
            time={{ mode: 'uncontrolled', duration: piece.duration, loop: true, loopGap: piece.hold ?? 3, playing: visible }}
            quality={piece.quality ?? { smoothing: true }}
            plugins={plugins}
          >
            {piece.text}
          </TegakiRenderer>
        )}
      </div>
      <figcaption>
        <span>{piece.title}</span>
        <code className="plug-uses">
          {piece.uses.map((use, i) => (
            <Fragment key={use.name}>
              {i > 0 && ' + '}
              <a href={use.href} title={`${use.name} plugin source on GitHub`}>
                {use.name}
              </a>
            </Fragment>
          ))}
        </code>
      </figcaption>
    </figure>
  );
}

/** A gallery of the Studio's demo plugins, each on its own material. */
export function Plugins() {
  return (
    <div className="plugs">
      {SHOWPIECES.map((p) => (
        <ShowpieceCard key={p.id} piece={p} />
      ))}
    </div>
  );
}

/** The plugin in `rainbow.ts`, whose source is printed beside it. */
export function RainbowDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '300px 0px' });
  const visible = useInView(ref);
  const font = useFont(near ? 'Caveat' : null);
  const plugins = useMemo(() => [rainbow()], []);

  return (
    <div ref={ref} className="own-ink">
      {font && (
        <TegakiRenderer
          font={font}
          time={{ mode: 'uncontrolled', duration: 3.2, loop: true, loopGap: 2.5, playing: visible }}
          quality={{ smoothing: true }}
          plugins={plugins}
        >
          {'over the\nrainbow'}
        </TegakiRenderer>
      )}
    </div>
  );
}
