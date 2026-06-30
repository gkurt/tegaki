import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { TegakiEngine } from 'tegaki';

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the navigation has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render the engine at an absolute time (seconds) and return its backing canvas. */
function renderAt(engine: TegakiEngine, t: number): HTMLCanvasElement {
  engine.update({ time: t });
  return engine.canvas;
}

/**
 * Composite the engine's (transparent) canvas onto a target sized in CSS px,
 * optionally filling a background first. `scale` upsamples the target relative
 * to CSS px (the source canvas is already supersampled, so this just controls
 * output resolution).
 */
function compositeTo(target: HTMLCanvasElement, source: HTMLCanvasElement, cssW: number, cssH: number, background: string | null) {
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
  }
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
  void cssW;
  void cssH;
}

export interface ExportProgress {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

// --- SVG -------------------------------------------------------------------

export function exportSvg(engine: TegakiEngine, opts: { animated: boolean; loop?: boolean }): Blob {
  const svg = engine.toSVG({ animated: opts.animated, loop: opts.loop });
  return new Blob([svg], { type: 'image/svg+xml' });
}

// --- PNG (current frame) ---------------------------------------------------

export async function exportPng(engine: TegakiEngine, opts: { background?: string | null } = {}): Promise<Blob> {
  const source = engine.canvas;
  const target = document.createElement('canvas');
  target.width = source.width;
  target.height = source.height;
  compositeTo(target, source, source.offsetWidth, source.offsetHeight, opts.background ?? null);
  return await new Promise<Blob>((resolve, reject) => {
    target.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

// --- GIF (deterministic frame stepping) ------------------------------------

export async function exportGif(
  engine: TegakiEngine,
  opts: { fps?: number; maxWidth?: number; background?: string | null; holdMs?: number } & ExportProgress = {},
): Promise<Blob> {
  const fps = opts.fps ?? 20;
  const background = opts.background ?? '#ffffff';
  const duration = engine.duration;
  const source = engine.canvas;
  const cssW = source.offsetWidth;
  const cssH = source.offsetHeight;

  // Output resolution: source supersampled px, capped at maxWidth.
  const maxWidth = opts.maxWidth ?? 800;
  const outScale = Math.min(1, maxWidth / source.width);
  const outW = Math.max(1, Math.round(source.width * outScale));
  const outH = Math.max(1, Math.round(source.height * outScale));

  const target = document.createElement('canvas');
  target.width = outW;
  target.height = outH;
  const ctx = target.getContext('2d', { willReadFrequently: true })!;

  const gif = GIFEncoder();
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const delay = Math.round(1000 / fps);
  const restore = engine.currentTime;

  for (let i = 0; i <= frameCount; i++) {
    if (opts.signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
    const t = Math.min(i / fps, duration);
    renderAt(engine, t);
    compositeTo(target, source, cssW, cssH, background);
    const { data } = ctx.getImageData(0, 0, outW, outH);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    // Hold the last frame a touch longer so loops read clearly.
    const isLast = i === frameCount;
    gif.writeFrame(index, outW, outH, { palette, delay: isLast ? delay + (opts.holdMs ?? 600) : delay });
    opts.onProgress?.(i / frameCount);
    // Yield so the progress UI can paint.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  engine.update({ time: restore });
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

// --- WebM (real-time canvas capture) ---------------------------------------

export function webmSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function pickWebmMime(): string | undefined {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export async function exportWebm(
  engine: TegakiEngine,
  opts: { fps?: number; background?: string | null } & ExportProgress = {},
): Promise<Blob> {
  if (!webmSupported()) throw new Error('WebM capture is not supported in this browser');
  const fps = opts.fps ?? 30;
  const background = opts.background ?? '#ffffff';
  const duration = engine.duration;
  const source = engine.canvas;
  const cssW = source.offsetWidth;
  const cssH = source.offsetHeight;

  // Capture from an intermediate canvas so we control background + framerate
  // independently of the engine's transparent supersampled buffer.
  const target = document.createElement('canvas');
  target.width = source.width;
  target.height = source.height;

  const stream = target.captureStream(fps);
  const mime = pickWebmMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const restore = engine.currentTime;
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime ?? 'video/webm' }));
  });

  recorder.start();
  const startTs = performance.now();

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - startTs) / 1000;
      const t = Math.min(elapsed, duration);
      renderAt(engine, t);
      compositeTo(target, source, cssW, cssH, background);
      opts.onProgress?.(Math.min(t / duration, 1));
      if (opts.signal?.aborted || elapsed >= duration) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Hold the final frame briefly so the video doesn't cut on the last stroke.
  await new Promise((r) => setTimeout(r, 400));
  recorder.stop();
  const blob = await done;
  engine.update({ time: restore });
  return blob;
}
