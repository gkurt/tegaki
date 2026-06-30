import { useCallback, useEffect, useRef, useState } from 'react';
import type { TegakiEngine } from 'tegaki';
import { downloadBlob, exportGif, exportPng, exportSvg, exportWebm, webmSupported } from './export.ts';

type Format = 'svg' | 'png' | 'gif' | 'webm';

const FORMATS: { key: Format; label: string }[] = [
  { key: 'svg', label: 'SVG' },
  { key: 'png', label: 'PNG' },
  { key: 'gif', label: 'GIF' },
  { key: 'webm', label: 'WebM' },
];

/** Slugify the preview text into a safe-ish base filename. */
function baseName(text: string): string {
  const slug = text
    .trim()
    .slice(0, 24)
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
  return slug || 'tegaki';
}

export function ExportPanel({
  getEngine,
  text,
  onExportStart,
}: {
  getEngine: () => TegakiEngine | null;
  text: string;
  onExportStart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('svg');
  const [animated, setAnimated] = useState(true);
  const [loop, setLoop] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const [fps, setFps] = useState(20);
  const [maxWidth, setMaxWidth] = useState(800);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const webmOk = webmSupported();
  const bg = transparent ? null : '#ffffff';

  const run = useCallback(async () => {
    const engine = getEngine();
    if (!engine) {
      setError('Renderer not ready');
      return;
    }
    onExportStart?.();
    setError(null);
    setBusy(true);
    setProgress(0);
    const abort = new AbortController();
    abortRef.current = abort;
    const name = baseName(text);
    try {
      // Let the host pause its playback loop before we drive the engine.
      await new Promise((r) => requestAnimationFrame(r));
      if (format === 'svg') {
        const blob = exportSvg(engine, { animated, loop: animated && loop });
        downloadBlob(blob, `${name}${animated ? '-animated' : ''}.svg`);
      } else if (format === 'png') {
        const blob = await exportPng(engine, { background: bg });
        downloadBlob(blob, `${name}.png`);
      } else if (format === 'gif') {
        const blob = await exportGif(engine, {
          fps,
          maxWidth,
          background: bg ?? '#ffffff',
          onProgress: setProgress,
          signal: abort.signal,
        });
        downloadBlob(blob, `${name}.gif`);
      } else if (format === 'webm') {
        const blob = await exportWebm(engine, {
          fps: Math.max(fps, 24),
          background: bg ?? '#ffffff',
          onProgress: setProgress,
          signal: abort.signal,
        });
        downloadBlob(blob, `${name}.webm`);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError((err as Error)?.message ?? 'Export failed');
    } finally {
      setBusy(false);
      setProgress(0);
      abortRef.current = null;
    }
  }, [getEngine, onExportStart, text, format, animated, loop, bg, fps, maxWidth]);

  const showBackground = format === 'png' || format === 'gif' || format === 'webm';
  const showFps = format === 'gif' || format === 'webm';

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
          open ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex flex-col gap-3 z-10">
          {/* Format tabs */}
          <div className="flex gap-0.5">
            {FORMATS.map((f) => {
              const disabled = f.key === 'webm' && !webmOk;
              return (
                <button
                  type="button"
                  key={f.key}
                  disabled={disabled}
                  title={disabled ? 'WebM capture not supported in this browser' : undefined}
                  className={`flex-1 px-2 py-1 text-xs rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    format === f.key ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setFormat(f.key)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Format-specific options */}
          <div className="flex flex-col gap-2 text-xs text-gray-600">
            {format === 'svg' && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={animated} onChange={(e) => setAnimated(e.target.checked)} />
                  Self-drawing animation
                </label>
                {animated && (
                  <label className="flex items-center gap-2 cursor-pointer pl-5">
                    <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                    Loop forever
                  </label>
                )}
                <p className="text-[11px] text-gray-400 leading-snug">
                  {!animated
                    ? 'Static final artwork (every stroke fully drawn).'
                    : loop
                      ? 'Loops forever via CSS keyframes (constant width) — ideal for a README hero or embed.'
                      : 'Draws itself once on load, then stays complete (variable width via per-stroke mask reveal).'}
                </p>
              </>
            )}

            {format === 'png' && (
              <p className="text-[11px] text-gray-400 leading-snug">Exports the current frame. Seek/pause first to pick the moment.</p>
            )}

            {showFps && (
              <label className="flex items-center justify-between">
                Frame rate
                <span className="flex items-center gap-1">
                  <input
                    type="range"
                    className="w-24"
                    min={8}
                    max={format === 'webm' ? 60 : 30}
                    step={1}
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                  />
                  <span className="tabular-nums w-9 text-right text-gray-400">{fps}fps</span>
                </span>
              </label>
            )}

            {format === 'gif' && (
              <label className="flex items-center justify-between">
                Max width
                <span className="flex items-center gap-1">
                  <input
                    type="range"
                    className="w-24"
                    min={200}
                    max={1600}
                    step={50}
                    value={maxWidth}
                    onChange={(e) => setMaxWidth(Number(e.target.value))}
                  />
                  <span className="tabular-nums w-10 text-right text-gray-400">{maxWidth}px</span>
                </span>
              </label>
            )}

            {showBackground && (
              <label className={`flex items-center gap-2 ${format === 'png' ? 'cursor-pointer' : ''}`}>
                <input
                  type="checkbox"
                  checked={transparent}
                  disabled={format === 'gif' || format === 'webm'}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                Transparent background
                {(format === 'gif' || format === 'webm') && (
                  <span className="text-[11px] text-gray-400">(white — format has no alpha)</span>
                )}
              </label>
            )}
          </div>

          {/* Action / progress */}
          {busy ? (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-gray-800 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <button
                type="button"
                className="px-2 py-1 text-xs rounded cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-600"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel ({Math.round(progress * 100)}%)
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded cursor-pointer bg-gray-800 hover:bg-gray-700 text-white"
              onClick={run}
            >
              Export {format.toUpperCase()}
            </button>
          )}

          {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}
        </div>
      )}
    </div>
  );
}
