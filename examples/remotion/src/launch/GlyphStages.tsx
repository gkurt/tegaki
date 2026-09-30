import { useLayoutEffect, useRef } from 'react';
import { drawGlyph, type TegakiGlyphData } from 'tegaki/core';
import type { Bundle } from './fonts.ts';
import { C, lerp } from './theme.ts';

const STROKE_COLORS = [C.seal, '#3f6fd8', '#2f9a67', '#c9892c', '#8a4fd1'];

export interface GlyphStagesProps {
  font: Bundle;
  char: string;
  /** The box to fit the glyph in. */
  width: number;
  height: number;
  fontSize: number;
  /** 0–1: the outline tracing itself. */
  outline: number;
  /** 0–1: the centerlines found inside it. */
  skeleton: number;
  /** 0–1: the strokes, ordered and numbered. */
  strokes: number;
  /** Seconds into the glyph's own animation (the final, written). `null` before the final. */
  write: number | null;
}

/**
 * One glyph through the pipeline, the way the Studio's Glyphs mode shows it:
 * the font's outline, the centerlines inside it, the strokes in pen order,
 * and the glyph written by the renderer's own `drawGlyph`, all in one frame.
 */
export const GlyphStages: React.FC<GlyphStagesProps> = ({ font, char, width, height, fontSize, outline, skeleton, strokes, write }) => {
  const glyph = (font.glyphData as Record<string, TegakiGlyphData>)[char]!;
  const scale = fontSize / font.unitsPerEm;
  // Fit the ink's box (font units, y down from the baseline) in the middle.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of glyph.s)
    for (const [x, y] of s.p) {
      minX = Math.min(minX, x!);
      maxX = Math.max(maxX, x!);
      minY = Math.min(minY, y!);
      maxY = Math.max(maxY, y!);
    }
  const ox = width / 2 - ((minX + maxX) / 2) * scale;
  const baseline = height / 2 - ((minY + maxY) / 2) * scale;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => baseline + y * scale;

  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = 2;
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (write === null) return;
    drawGlyph(
      ctx,
      glyph,
      {
        x: ox,
        y: baseline - font.ascender * scale,
        fontSize,
        unitsPerEm: font.unitsPerEm,
        ascender: font.ascender,
        descender: font.descender,
      },
      write,
      { color: C.ink, lineCap: font.lineCap },
    );
  });

  const fade = write === null ? 1 : Math.max(0, 1 - write * 3);
  return (
    <div style={{ position: 'relative', width, height }}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {/* The font's outline, tracing itself, then left as a pale fill. */}
        <text
          x={ox}
          y={baseline}
          fontFamily={`"${font.family}"`}
          fontSize={fontSize}
          fill={`rgba(28, 29, 43, ${0.07 * skeleton})`}
          stroke={C.ink}
          strokeOpacity={lerp(0.9, 0.25, skeleton) * fade}
          strokeWidth={2}
          strokeDasharray="5000"
          strokeDashoffset={5000 * (1 - outline)}
        >
          {char}
        </text>
        {/* Centerlines: the ink graph inside the outline. */}
        {glyph.s.map((s, i) => {
          const pts = s.p.map(([x, y]) => `${X(x!)},${Y(y!)}`).join(' ');
          return (
            <polyline
              key={`sk${i}`}
              points={pts}
              fill="none"
              stroke="#3f6fd8"
              strokeWidth={3}
              strokeDasharray="2 9"
              strokeLinecap="round"
              pathLength={1}
              opacity={skeleton * (1 - strokes) * fade}
            />
          );
        })}
        {glyph.s.map((s, i) =>
          s.p.map(([x, y], j) =>
            j % 3 === 0 ? (
              <circle
                key={`pt${i}-${j}`}
                cx={X(x!)}
                cy={Y(y!)}
                r={3.2}
                fill="#3f6fd8"
                opacity={Math.max(0, Math.min(1, skeleton * 2 - (j / s.p.length) * 0.8)) * (1 - strokes) * fade}
              />
            ) : null,
          ),
        )}
        {/* Strokes in pen order: each drawn with its direction and number. */}
        {glyph.s.map((s, i) => {
          const n = glyph.s.length;
          const local = Math.max(0, Math.min(1, strokes * (n + 0.6) - i));
          const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
          const [x0, y0] = s.p[0]!;
          const d = `M ${s.p.map(([x, y]) => `${X(x!)} ${Y(y!)}`).join(' L ')}`;
          return (
            <g key={`st${i}`} opacity={(local > 0 ? 1 : 0) * fade}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - local}
                markerEnd={local > 0.98 ? 'url(#arrow)' : undefined}
                opacity={0.9}
              />
              <circle cx={X(x0!)} cy={Y(y0!)} r={19 * Math.min(1, local * 4)} fill={color} />
              <text
                x={X(x0!)}
                y={Y(y0!) + 7}
                textAnchor="middle"
                fontFamily="Geist, sans-serif"
                fontWeight={600}
                fontSize={20}
                fill="#fff"
                opacity={Math.min(1, local * 4)}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <canvas
        ref={canvas}
        width={width * dpr}
        height={height * dpr}
        style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none' }}
      />
    </div>
  );
};
