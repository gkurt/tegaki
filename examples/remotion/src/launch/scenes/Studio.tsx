import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { boilPlugin, glowPlugin, strokeGradientPlugin } from 'tegaki/core';
import { Cursor, cursorAt } from '../components.tsx';
import { FONTS, family } from '../fonts.ts';
import { GlyphStages } from '../GlyphStages.tsx';
import { C, EASE, keys, MONO, ramp, SANS } from '../theme.ts';
import { STUDIO } from '../timing.ts';
import { Write } from '../Write.tsx';

// The window, in its own px.
const W = 1640;
const H = 920;
const TOP = 56;
const INSPECTOR = 380;
const SIDEBAR = 220;
const CANVAS_W = W - INSPECTOR;

// When things happen (scene frames).
const T = STUDIO;

const RAINBOW = strokeGradientPlugin({ saturation: 85, lightness: 58 });
const GLOW = glowPlugin({ radius: 0.1 });
const BOIL = boilPlugin({ amount: 0.02 });
const PLUGIN_SETS = [[], [RAINBOW], [RAINBOW, GLOW], [RAINBOW, GLOW, BOIL]] as const;
const HQ = { pixelRatio: 1.5 };

const STAGES = ['Outline', 'Skeleton', 'Strokes', 'Final'];
const STAGE_X = (i: number) => SIDEBAR + (CANVAS_W - SIDEBAR) / 2 - 252 + i * 128 + 60;
const PLUGINS = ['Glow', 'Rainbow', 'Boil', 'Variation', 'Annotate', 'Taper', 'Neon', 'Chalk', 'Wet ink', 'Typewriter'];
const EXPORTS = ['glowPlugin()', 'strokeGradientPlugin()', 'boilPlugin()', 'variationPlugin()', 'annotatePlugin()', 'taperPlugin()'];
const PLUGIN_Y = (i: number) => TOP + 64 + i * 62 + 31;
const FONT_LIST = [
  { name: 'Caveat', family: family(FONTS.caveat) },
  { name: 'Parisienne', family: family(FONTS.parisienne) },
  { name: 'Italianno', family: family(FONTS.italianno) },
  { name: 'Tangerine', family: family(FONTS.tangerine) },
  { name: 'Klee One', family: SANS },
  { name: 'Amiri', family: SANS },
];
const TABS = ['Style', 'Motion', 'Plugins', 'Pipeline'];
const TAB_X = (i: number) => CANVAS_W + 47.5 + i * 95;

const CURSOR: [number, number, number, boolean?][] = [
  [20, 1000, 900],
  [T.skeleton - 2, STAGE_X(1), 93],
  [T.skeleton, STAGE_X(1), 93, true],
  [T.strokes - 2, STAGE_X(2), 93],
  [T.strokes, STAGE_X(2), 93, true],
  [T.final - 3, STAGE_X(3), 93],
  [T.final, STAGE_X(3), 93, true],
  [T.final + 16, 700, 200],
  [T.text - 3, 772, 28],
  [T.text, 772, 28, true],
  [T.picker - 4, 300, 28],
  [T.picker, 300, 28, true],
  [T.picker + 9, 320, 178],
  [T.parisienne - 4, 320, 132],
  [T.parisienne, 320, 132, true],
  [T.pluginsTab - 4, TAB_X(2), 78],
  [T.pluginsTab, TAB_X(2), 78, true],
  [T.rainbow - 3, W - 52, PLUGIN_Y(1)],
  [T.rainbow, W - 52, PLUGIN_Y(1), true],
  [T.glow - 3, W - 52, PLUGIN_Y(0)],
  [T.glow, W - 52, PLUGIN_Y(0), true],
  [T.boil - 3, W - 52, PLUGIN_Y(2)],
  [T.boil, W - 52, PLUGIN_Y(2), true],
  [T.whip[1], 900, 600],
];

const box = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });

const Switch: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ width: 44, height: 26, borderRadius: 99, background: on > 0.5 ? C.ink : 'rgba(28,29,43,0.14)', position: 'relative' }}>
    <div
      style={{
        position: 'absolute',
        top: 3,
        left: 3 + on * 18,
        width: 20,
        height: 20,
        borderRadius: 99,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    />
  </div>
);

const Slider: React.FC<{ label: string; value: number; text: string }> = ({ label, value, text }) => (
  <div style={{ padding: '14px 24px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: SANS, fontSize: 15, color: C.inkSoft, marginBottom: 10 }}>
      <span>{label}</span>
      <span style={{ fontFamily: MONO, color: C.muted }}>{text}</span>
    </div>
    <div style={{ height: 6, borderRadius: 9, background: 'rgba(28,29,43,0.08)', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, width: `${value * 100}%`, borderRadius: 9, background: C.ink }} />
      <div
        style={{
          position: 'absolute',
          left: `calc(${value * 100}% - 9px)`,
          top: -6,
          width: 18,
          height: 18,
          borderRadius: 99,
          background: '#fff',
          border: `2px solid ${C.ink}`,
        }}
      />
    </div>
  </div>
);

const Button: React.FC<{ children: ReactNode; dark?: boolean; style?: CSSProperties }> = ({ children, dark, style }) => (
  <div
    style={{
      height: 34,
      padding: '0 14px',
      borderRadius: 9,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: SANS,
      fontSize: 14,
      fontWeight: 500,
      color: dark ? C.card : C.ink,
      background: dark ? C.ink : 'transparent',
      border: dark ? 'none' : `1px solid ${C.rule}`,
      ...style,
    }}
  >
    {children}
  </div>
);

/** The Studio, mocked: Glyphs mode walks a glyph through the pipeline, Text mode swaps the font and turns plugins on. */
export const Studio: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = ramp(frame, 0, 26, EASE.out);
  const textMode = frame >= T.text;
  const modeFade = ramp(frame, T.text, T.text + 8, EASE.out);
  const cur = cursorAt(frame, CURSOR);
  // Camera: in on the glyph while it's taken apart, back out for text mode.
  // ...and out through the canvas into the next scene.
  const whip = ramp(frame, T.whip[0], T.whip[1], EASE.in);
  const zoom = keys(frame, [10, 58, T.final + 22, T.text + 4, T.whip[0]], [1, 1.16, 1.16, 1, 1.03], EASE.inOut) * (1 + whip * whip * 2.4);
  const zoomY = keys(frame, [10, 58, T.final + 22, T.text + 4], [0, 60, 60, 0], EASE.inOut);

  const stage = frame < T.skeleton ? 0 : frame < T.strokes ? 1 : frame < T.final ? 2 : 3;
  const pickerOpen = frame >= T.picker && frame < T.parisienne + 2 ? ramp(frame, T.picker, T.picker + 7, EASE.out) : 0;
  const tab = frame >= T.pluginsTab ? 2 : textMode ? 0 : 3;
  const font = frame >= T.parisienne ? 'Parisienne' : 'Caveat';
  const plugOn = [frame >= T.glow ? 1 : 0, frame >= T.rainbow ? 1 : 0, frame >= T.boil ? 1 : 0];
  const plugins = PLUGIN_SETS[plugOn.reduce((a, b) => a + b, 0) as 0 | 1 | 2 | 3];
  const writeFrom = frame >= T.parisienne ? T.parisienne + 2 : T.text + 4;
  const writeFrames = T.writeFrames;
  const playback = Math.min(1, (frame - writeFrom) / writeFrames);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, #efe7d8 0%, #ddd3c0 100%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: W,
            height: H,
            position: 'relative',
            borderRadius: 18,
            overflow: 'hidden',
            background: C.card,
            boxShadow: '0 2px 4px rgba(60,40,10,0.06), 0 30px 80px -20px rgba(60,40,10,0.35), 0 0 0 1px rgba(28,29,43,0.08)',
            opacity: enter,
            transformOrigin: '42% 50%',
            filter: whip > 0 ? `blur(${whip * whip * 10}px)` : undefined,
            transform: `translateY(${(1 - enter) * 120 + zoomY}px) scale(${(0.94 + 0.06 * enter) * zoom})`,
          }}
        >
          {/* Top bar */}
          <div style={box({ left: 0, top: 0, width: W, height: TOP, borderBottom: `1px solid ${C.rule}`, background: '#f7f2e8' })}>
            <div style={box({ left: 20, top: 22, display: 'flex', gap: 8 })}>
              {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                <div key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
              ))}
            </div>
            <div style={box({ left: 92, top: 8, fontFamily: family(FONTS.caveat), fontSize: 34, color: C.ink })}>tegaki</div>
            <div style={box({ left: 186, top: 11 })}>
              <Button>
                <span style={{ fontFamily: family(FONTS[font === 'Caveat' ? 'caveat' : 'parisienne']), fontSize: 22 }}>Aa</span>
                <span>{font}</span>
                <span style={{ color: C.muted }}>▾</span>
              </Button>
            </div>
            <div style={box({ left: 724, top: 11, display: 'flex', padding: 3, borderRadius: 10, background: 'rgba(28,29,43,0.06)' })}>
              {['Text', 'Glyphs'].map((m, i) => (
                <div
                  key={m}
                  style={{
                    width: 90,
                    height: 28,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: SANS,
                    fontSize: 14,
                    fontWeight: 500,
                    color: C.ink,
                    background: (i === 0) === textMode ? '#fff' : 'transparent',
                    boxShadow: (i === 0) === textMode ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
            <div style={box({ right: 20, top: 11, display: 'flex', gap: 10 })}>
              <Button>✦ Ask an agent</Button>
              <Button dark>Export</Button>
            </div>
          </div>

          {/* Glyphs mode */}
          <div style={box({ left: 0, top: TOP, width: CANVAS_W, height: H - TOP, opacity: 1 - modeFade })}>
            <div
              style={box({ left: 0, top: 0, width: SIDEBAR, height: H - TOP, borderRight: `1px solid ${C.rule}`, background: '#f7f2e8' })}
            >
              <div style={{ padding: '18px 18px 10px', fontFamily: MONO, fontSize: 12, letterSpacing: 2, color: C.muted }}>LATIN · 96</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 14px' }}>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'.split('').map((ch) => (
                  <div
                    key={ch}
                    style={{
                      height: 42,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: family(FONTS.caveat),
                      fontSize: 26,
                      color: ch === 'E' ? '#fff' : C.inkSoft,
                      background: ch === 'E' ? C.ink : 'transparent',
                    }}
                  >
                    {ch}
                  </div>
                ))}
              </div>
            </div>
            <div style={box({ left: SIDEBAR, top: 20, width: CANVAS_W - SIDEBAR, display: 'flex', justifyContent: 'center', gap: 8 })}>
              {STAGES.map((s, i) => (
                <div
                  key={s}
                  style={{
                    width: 120,
                    height: 34,
                    borderRadius: 99,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: SANS,
                    fontSize: 14,
                    fontWeight: 500,
                    color: i === stage ? '#fff' : C.inkSoft,
                    background: i === stage ? C.ink : 'rgba(28,29,43,0.05)',
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
            <div
              style={box({
                left: SIDEBAR,
                top: 60,
                width: CANVAS_W - SIDEBAR,
                height: H - TOP - 60,
                backgroundImage: 'radial-gradient(rgba(28,29,43,0.12) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              })}
            >
              <GlyphStages
                font={FONTS.caveat}
                char="E"
                width={CANVAS_W - SIDEBAR}
                height={H - TOP - 60}
                fontSize={600}
                outline={ramp(frame, 12, T.skeleton - 2, EASE.inOut)}
                skeleton={ramp(frame, T.skeleton, T.skeleton + 16, EASE.out)}
                strokes={ramp(frame, T.strokes, T.final - 4, EASE.inOut)}
                write={frame >= T.final ? ((frame - T.final) / 30) * 1.1 : null}
              />
            </div>
          </div>

          {/* Text mode */}
          {textMode && (
            <div
              style={box({
                left: 0,
                top: TOP,
                width: CANVAS_W,
                height: H - TOP,
                opacity: modeFade,
                backgroundImage: 'radial-gradient(rgba(28,29,43,0.12) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              })}
            >
              <div style={box({ inset: 0, bottom: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <div style={{ border: '1.5px dashed rgba(28,29,43,0.22)', borderRadius: 6, padding: '10px 40px' }}>
                  {font === 'Caveat' ? (
                    <Write
                      key="c"
                      font={FONTS.caveat}
                      text="Make it yours"
                      from={T.text + 4}
                      frames={writeFrames}
                      size={150}
                      color={C.ink}
                      quality={HQ}
                    />
                  ) : (
                    <Write
                      key="p"
                      font={FONTS.parisienne}
                      text="Make it yours"
                      from={T.parisienne + 2}
                      frames={writeFrames}
                      size={170}
                      color={C.ink}
                      plugins={plugins}
                      quality={HQ}
                    />
                  )}
                </div>
              </div>
              {/* Transport */}
              <div style={box({ left: 40, right: 40, bottom: 28, height: 44, display: 'flex', alignItems: 'center', gap: 18 })}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 99,
                    background: C.ink,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                  }}
                >
                  ▶
                </div>
                <div style={{ flex: 1, height: 4, borderRadius: 9, background: 'rgba(28,29,43,0.1)', position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${Math.max(0, playback) * 100}%`,
                      background: C.seal,
                      borderRadius: 9,
                    }}
                  />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: C.muted, width: 120, textAlign: 'right' }}>
                  {(Math.max(0, playback) * 2.4).toFixed(2)}s / 2.40s
                </div>
              </div>
            </div>
          )}

          {/* Inspector */}
          <div
            style={box({
              left: CANVAS_W,
              top: TOP,
              width: INSPECTOR,
              height: H - TOP,
              borderLeft: `1px solid ${C.rule}`,
              background: '#fdfbf6',
            })}
          >
            <div style={{ display: 'flex', height: 44, borderBottom: `1px solid ${C.rule}` }}>
              {TABS.map((t, i) => (
                <div
                  key={t}
                  style={{
                    width: 95,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: SANS,
                    fontSize: 14,
                    fontWeight: 500,
                    color: i === tab ? C.ink : C.muted,
                    borderBottom: i === tab ? `2px solid ${C.seal}` : '2px solid transparent',
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
            {tab === 3 && (
              <div>
                <Slider label="Resolution" value={0.4} text="400" />
                <Slider label="Spur tolerance" value={0.3} text="0.08" />
                <Slider label="Drawing speed" value={0.55} text="1.0×" />
                <div style={{ padding: '14px 24px', fontFamily: SANS, fontSize: 15, color: C.inkSoft }}>References</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 24px' }}>
                  {['KanjiVG', 'Make Me a Hanzi', 'Hershey', 'Letterpaths', 'Hangul', 'Drawn'].map((r) => (
                    <div
                      key={r}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 99,
                        border: `1px solid ${C.rule}`,
                        fontFamily: SANS,
                        fontSize: 13,
                        color: C.inkSoft,
                      }}
                    >
                      ✓ {r}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab === 0 && (
              <div>
                <Slider label="Font size" value={0.5} text="150px" />
                <Slider label="Speed" value={0.4} text="1.0×" />
                <Slider label="Pressure" value={0.8} text="0.80" />
                <div style={{ padding: '14px 24px', fontFamily: SANS, fontSize: 15, color: C.inkSoft }}>Color</div>
                <div style={{ display: 'flex', gap: 10, padding: '0 24px' }}>
                  {[C.ink, C.seal, '#3f6fd8', '#2f9a67', C.gold].map((c, i) => (
                    <div
                      key={c}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 99,
                        background: c,
                        outline: i === 0 ? `2px solid ${C.ink}` : 'none',
                        outlineOffset: 3,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {tab === 2 && (
              <div style={{ paddingTop: 20 }}>
                {PLUGINS.map((p, i) => {
                  const on = i < 3 ? plugOn[i]! : 0;
                  const click = i === 0 ? T.glow : i === 1 ? T.rainbow : T.boil;
                  const anim = i < 3 ? ramp(frame, click, click + 6, EASE.out) : 0;
                  return (
                    <div
                      key={p}
                      style={{
                        height: 62,
                        padding: '0 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: `1px solid ${C.rule}`,
                        opacity: ramp(frame, T.pluginsTab + i * 1.2, T.pluginsTab + 8 + i * 1.2),
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: SANS, fontSize: 16, fontWeight: 500, color: C.ink }}>{p}</div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{EXPORTS[i] ?? 'demo · createPlugin()'}</div>
                      </div>
                      <Switch on={on ? anim : 0} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Font picker */}
          {pickerOpen > 0 && (
            <div
              style={box({
                left: 186,
                top: TOP + 4,
                width: 260,
                padding: 6,
                borderRadius: 12,
                background: '#fff',
                boxShadow: '0 12px 40px -8px rgba(0,0,0,0.25), 0 0 0 1px rgba(28,29,43,0.08)',
                opacity: pickerOpen,
                transform: `translateY(${(1 - pickerOpen) * -8}px)`,
              })}
            >
              {FONT_LIST.map((f, i) => {
                const hover = Math.abs(cur.y - (TOP + 4 + 6 + i * 44 + 22)) < 22;
                return (
                  <div
                    key={f.name}
                    style={{
                      height: 44,
                      borderRadius: 8,
                      padding: '0 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: hover ? 'rgba(28,29,43,0.06)' : 'transparent',
                    }}
                  >
                    <span style={{ fontFamily: f.family, fontSize: f.family === SANS ? 16 : 26, color: C.ink }}>{f.name}</span>
                    {i === 0 && <span style={{ color: C.seal, fontFamily: SANS }}>✓</span>}
                  </div>
                );
              })}
              <div
                style={{
                  borderTop: `1px solid ${C.rule}`,
                  margin: '4px 0',
                  padding: '10px 12px 6px',
                  fontFamily: SANS,
                  fontSize: 14,
                  color: C.muted,
                }}
              >
                ＋ Upload a font…
              </div>
            </div>
          )}

          <Cursor x={cur.x} y={cur.y} down={cur.down} opacity={ramp(frame, 18, 26) * (1 - whip)} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#050505', opacity: whip }} />
    </AbsoluteFill>
  );
};
