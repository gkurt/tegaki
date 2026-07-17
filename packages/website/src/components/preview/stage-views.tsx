import { useEffect, useMemo } from 'react';
import {
  type GeometryPipelineResult,
  type GeometryStage,
  type PipelineResult,
  renderGeometryStage,
  renderStage,
  STROKE_COLORS,
  type VisualizationStage,
} from 'tegaki-generator';
import type { GeometryStageKey, Stage } from './constants.ts';
import { fitSize } from './utils.ts';

export function PNGView({ data, width, height }: { data: Uint8Array; width: number; height: number }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: 'image/png' })), [data]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const { width: dw, height: dh } = fitSize(width, height, 600);
  return <img src={url} alt="" className="border border-gray-200" style={{ imageRendering: 'pixelated', width: dw, height: dh }} />;
}

export function SVGView({ svg }: { svg: string }) {
  const { width: dw, height: dh } = useMemo(() => {
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    if (!vbMatch) return { width: 600, height: 600 };
    const [, , vw, vh] = vbMatch[1]!.split(' ').map(Number);
    return fitSize(vw!, vh!, 600);
  }, [svg]);
  return (
    <div
      className="[&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:border [&>svg]:border-gray-200"
      style={{ width: dw, height: dh }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from shared renderers is trusted
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function StageRenderer({ result, stage, animTime }: { result: PipelineResult; stage: Stage; animTime: number }) {
  if (stage === 'animation') return <AnimationView result={result} time={animTime} />;
  if (stage === 'final') return <FinalView result={result} time={animTime} />;

  const rendered = renderStage(result, stage as VisualizationStage);
  if (rendered instanceof Uint8Array) {
    return <PNGView data={rendered} width={result.bitmapWidth} height={result.bitmapHeight} />;
  }
  return <SVGView svg={rendered} />;
}

/** Geometry-pipeline stage renderer: static SVG stages + a client-driven animation. */
export function GeometryStageRenderer({
  result,
  stage,
  animTime,
}: {
  result: GeometryPipelineResult;
  stage: GeometryStageKey;
  animTime: number;
}) {
  if (stage === 'animation') return <GeometryAnimationView result={result} time={animTime} />;
  return <SVGView svg={renderGeometryStage(result, stage as GeometryStage)} />;
}

/** Progressive stroke draw for the geometry pipeline, in font-unit space. */
function GeometryAnimationView({ result, time }: { result: GeometryPipelineResult; time: number }) {
  const bb = result.pathBBox;
  const w = bb.x2 - bb.x1;
  const h = bb.y2 - bb.y1;
  const pad = Math.max(w, h) * 0.08 + 1;
  const vx = bb.x1 - pad;
  const vy = bb.y1 - pad;
  const vw = w + 2 * pad;
  const vh = h + 2 * pad;
  const { width: dw, height: dh } = fitSize(vw, vh, 600);

  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="border border-gray-200" style={{ width: dw, height: dh }}>
      <rect x={vx} y={vy} width={vw} height={vh} fill="white" />
      {result.strokesFontUnits.map((stroke, i) => {
        const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
        const avgWidth = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;
        const localTime = time - stroke.delay;
        if (localTime < 0) return null;

        if (stroke.points.length === 1) {
          const p = stroke.points[0]!;
          return <circle key={i} cx={p.x} cy={p.y} r={Math.max(avgWidth / 2, 1)} fill={color} />;
        }

        const d = stroke.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        let pathLen = 0;
        for (let j = 1; j < stroke.points.length; j++) {
          const dx = stroke.points[j]!.x - stroke.points[j - 1]!.x;
          const dy = stroke.points[j]!.y - stroke.points[j - 1]!.y;
          pathLen += Math.sqrt(dx * dx + dy * dy);
        }
        const progress = stroke.animationDuration > 0 ? Math.min(localTime / stroke.animationDuration, 1) : 1;
        const dashLen = pathLen + avgWidth;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(avgWidth, 1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashLen}
            strokeDashoffset={dashLen * (1 - progress)}
          />
        );
      })}
    </svg>
  );
}

function AnimationView({ result, time }: { result: PipelineResult; time: number }) {
  const { strokesFontUnits, lineCap, bitmapWidth: w, bitmapHeight: h, transform } = result;

  // Content-box viewBox: tight fit around rasterized content to match bitmap-based stages
  const vx = transform.offsetX;
  const vy = transform.offsetY;
  const vw = w / transform.scaleX;
  const vh = h / transform.scaleY;
  const { width: dw, height: dh } = fitSize(w, h, 600);

  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="border border-gray-200" style={{ width: dw, height: dh }}>
      <rect x={vx} y={vy} width={vw} height={vh} fill="white" />
      {strokesFontUnits.map((stroke, i) => {
        const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
        const avgWidth = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;
        const localTime = time - stroke.delay;

        if (localTime < 0) return null;

        if (stroke.points.length === 1) {
          const p = stroke.points[0]!;
          const size = Math.max(avgWidth, 0.5);
          return lineCap === 'round' ? (
            <circle key={i} cx={p.x} cy={p.y} r={size / 2} fill={color} />
          ) : (
            <rect key={i} x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} fill={color} />
          );
        }

        const d = stroke.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        let pathLen = 0;
        for (let j = 1; j < stroke.points.length; j++) {
          const dx = stroke.points[j]!.x - stroke.points[j - 1]!.x;
          const dy = stroke.points[j]!.y - stroke.points[j - 1]!.y;
          pathLen += Math.sqrt(dx * dx + dy * dy);
        }

        const progress = stroke.animationDuration > 0 ? Math.min(localTime / stroke.animationDuration, 1) : 1;
        const dashLen = pathLen + avgWidth;
        const dashOffset = dashLen * (1 - progress);

        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(avgWidth, 0.5)}
            strokeLinecap={lineCap}
            strokeLinejoin="round"
            strokeDasharray={dashLen}
            strokeDashoffset={dashOffset}
          />
        );
      })}
    </svg>
  );
}

function FinalView({ result, time }: { result: PipelineResult; time: number }) {
  const { strokesFontUnits, lineCap, bitmapWidth: bw, bitmapHeight: bh, transform, ascender, descender, advanceWidth } = result;

  // Container matches the content-box display size (same as bitmap-based stages)
  const { width: dw, height: dh } = fitSize(bw, bh, 600);

  // Em-square viewBox (matches production SVG output)
  const ew = advanceWidth;
  const eh = ascender - descender;

  // Content-box in font units
  const cx = transform.offsetX;
  const cy = transform.offsetY;
  const cw = bw / transform.scaleX;
  const ch = bh / transform.scaleY;

  // Scale the SVG so the content region fills exactly (dw, dh)
  const svgW = (dw * ew) / cw;
  const svgH = (dh * eh) / ch;

  // Offset to align the content region with the container's top-left
  const ox = (cx * dw) / cw;
  const oy = ((cy + ascender) * dh) / ch;

  return (
    <div className="border border-gray-200 overflow-hidden relative" style={{ width: dw, height: dh }}>
      <svg
        viewBox={`0 ${-ascender} ${ew} ${eh}`}
        style={{ position: 'absolute', left: -ox, top: -oy, width: svgW, height: svgH, overflow: 'visible' }}
      >
        <rect x={cx} y={cy} width={cw} height={ch} fill="white" />
        {strokesFontUnits.map((stroke, i) => {
          const avgWidth = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;
          const localTime = time - stroke.delay;

          if (localTime < 0) return null;

          if (stroke.points.length === 1) {
            const p = stroke.points[0]!;
            const size = Math.max(avgWidth, 0.5);
            return lineCap === 'round' ? (
              <circle key={i} cx={p.x} cy={p.y} r={size / 2} fill="currentColor" />
            ) : (
              <rect key={i} x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} fill="currentColor" />
            );
          }

          const d = stroke.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          let pathLen = 0;
          for (let j = 1; j < stroke.points.length; j++) {
            const dx = stroke.points[j]!.x - stroke.points[j - 1]!.x;
            const dy = stroke.points[j]!.y - stroke.points[j - 1]!.y;
            pathLen += Math.sqrt(dx * dx + dy * dy);
          }

          const progress = stroke.animationDuration > 0 ? Math.min(localTime / stroke.animationDuration, 1) : 1;
          const dashLen = pathLen + avgWidth;
          const dashOffset = dashLen * (1 - progress);

          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={Math.max(avgWidth, 0.5)}
              strokeLinecap={lineCap}
              strokeLinejoin="round"
              strokeDasharray={dashLen}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function AnimationControls({
  totalDuration,
  time,
  setTime,
  playing,
  setPlaying,
}: {
  totalDuration: number;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-200 bg-white h-[44px]">
      <button
        type="button"
        className="px-3 py-1 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-100"
        onClick={() => {
          if (time >= totalDuration) setTime(0);
          setPlaying(!playing);
        }}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        className="px-3 py-1 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-100"
        onClick={() => {
          setTime(0);
          setPlaying(false);
        }}
      >
        Reset
      </button>
      <span className="text-xs tabular-nums text-gray-500 w-24">
        {time.toFixed(2)}s / {totalDuration.toFixed(2)}s
      </span>
      <input
        type="range"
        className="flex-1 max-w-64"
        min={0}
        max={totalDuration}
        step={0.01}
        value={time}
        onChange={(e) => {
          setTime(Number(e.target.value));
          setPlaying(false);
        }}
      />
    </div>
  );
}
