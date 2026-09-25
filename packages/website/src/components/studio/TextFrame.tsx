import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ResetIcon } from './icons.tsx';
import { cx, Popover } from './ui.tsx';

const MIN_WIDTH = 40;
const MAX_WIDTH = 4000;
const PRESETS: { width: number; label: string }[] = [
  { width: 320, label: 'Phone' },
  { width: 480, label: 'Card' },
  { width: 768, label: 'Tablet' },
  { width: 1024, label: 'Desktop' },
];

const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

/**
 * A resizable box around the rendered text, so wrapping can be checked at any
 * width. `width === null` is Auto: the frame fills the canvas (up to
 * `autoClassName`'s cap). Drag the right edge (Shift snaps to 10px), use the
 * arrow keys on the handle, or pick a preset; double-click the handle or press
 * Reset to go back to Auto.
 */
export function TextFrame({
  width,
  onWidthChange,
  autoClassName,
  children,
}: {
  width: number | null;
  onWidthChange: (width: number | null) => void;
  autoClassName: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMeasured(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Coalesce pointer moves to one width update per frame — each one re-lays out the text.
  const pending = useRef<number | null>(null);
  const raf = useRef(0);
  const schedule = (w: number) => {
    pending.current = w;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current !== null) onWidthChange(pending.current);
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = frameRef.current?.getBoundingClientRect().width ?? measured;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      let w = startWidth + ev.clientX - startX;
      if (ev.shiftKey) w = Math.round(w / 10) * 10;
      schedule(clamp(w));
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const current = width ?? measured;
    if (e.key === 'ArrowRight') onWidthChange(clamp(current + step));
    else if (e.key === 'ArrowLeft') onWidthChange(clamp(current - step));
    else if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace') onWidthChange(null);
    else return;
    e.preventDefault();
  };

  const shown = width ?? measured;
  const active = dragging || presetsOpen;

  return (
    <div
      ref={frameRef}
      className={cx('group relative', width === null ? autoClassName : 'shrink-0')}
      style={width !== null ? { width } : undefined}
    >
      {/* The frame outline sits just outside the text box so it never covers ink. */}
      <div
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute -inset-x-px -inset-y-3 rounded-sm border border-dashed transition-colors',
          active || width !== null
            ? 'border-indigo-400/70 dark:border-indigo-400/50'
            : 'border-zinc-300/70 group-hover:border-zinc-400 dark:border-zinc-700/70 dark:group-hover:border-zinc-600',
        )}
      />

      <div className="absolute right-0 -top-10 flex items-center gap-0.5">
        <Popover
          open={presetsOpen}
          onOpenChange={setPresetsOpen}
          align="end"
          panelClassName="w-44 p-1"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              title="Text frame width"
              className={cx(
                'flex h-6 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] tabular-nums transition-colors',
                width !== null || active
                  ? 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/15'
                  : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                open && 'bg-zinc-100 dark:bg-zinc-800',
              )}
            >
              {width === null && <span className="font-sans">Auto ·</span>}
              {shown}px
            </button>
          )}
        >
          <WidthPresets
            width={width}
            measured={measured}
            onPick={(w) => {
              onWidthChange(w);
              setPresetsOpen(false);
            }}
          />
        </Popover>
        {width !== null && (
          <button
            type="button"
            onClick={() => onWidthChange(null)}
            title="Reset width (fill the canvas)"
            aria-label="Reset width"
            className="inline-flex size-6 items-center justify-center rounded-md text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/15"
          >
            <ResetIcon size={12} />
          </button>
        )}
      </div>

      {children}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize text frame"
        aria-valuenow={shown}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize · Shift snaps to 10px · double-click resets"
        onPointerDown={onPointerDown}
        onDoubleClick={() => onWidthChange(null)}
        onKeyDown={onKeyDown}
        className="absolute -inset-y-3 -right-3 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center outline-none [&:focus-visible>span]:bg-indigo-500"
      >
        <span
          className={cx(
            'h-10 w-1.5 rounded-full transition-colors',
            active ? 'bg-indigo-500' : 'bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-500',
          )}
        />
      </div>
    </div>
  );
}

function WidthPresets({ width, measured, onPick }: { width: number | null; measured: number; onPick: (w: number | null) => void }) {
  const [draft, setDraft] = useState(String(width ?? measured));
  const item =
    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) onPick(clamp(n));
  };
  return (
    <>
      <button
        type="button"
        className={cx(item, width === null && 'font-medium text-zinc-900 dark:text-zinc-100')}
        onClick={() => onPick(null)}
      >
        Auto
        <span className="ml-auto text-[11px] text-zinc-400">fill canvas</span>
      </button>
      {PRESETS.map((p) => (
        <button
          key={p.width}
          type="button"
          className={cx(item, width === p.width && 'font-medium text-zinc-900 dark:text-zinc-100')}
          onClick={() => onPick(p.width)}
        >
          <span className="font-mono tabular-nums">{p.width}px</span>
          <span className="ml-auto text-[11px] text-zinc-400">{p.label}</span>
        </button>
      ))}
      <div className="mt-1 flex items-center gap-1.5 border-t border-zinc-100 px-1 pt-2 pb-1 dark:border-zinc-800">
        <input
          type="number"
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label="Custom width in pixels"
          className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 font-mono text-[12px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={commit}
          className="h-7 rounded-md bg-zinc-900 px-2 text-[12px] font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Set
        </button>
      </div>
    </>
  );
}
