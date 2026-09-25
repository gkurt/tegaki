import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FitIcon, MinusIcon, ZoomInIcon } from './icons.tsx';
import { useShortcuts } from './shortcuts.ts';
import { cx } from './ui.tsx';

/** Floor for manual zoom-out; the fit itself goes lower when the stage is that small. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const PAD = 24;

/**
 * Pan/zoom viewport for the glyph stage. Starts fitted to the viewport (and
 * refits on resize) until the user zooms; ⌘/Ctrl + wheel (or a trackpad pinch)
 * zooms around the centre, and the corner controls zoom, fit, or reset to 100% (+/− and 0 zoom and fit too).
 * While fitted it never scrolls — only a zoom the user picked can overflow.
 */
export function ZoomStage({ children, contentKey, overlay }: { children: ReactNode; contentKey: string; overlay?: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Fit mode, as a ref for the resize observer and as state for the overflow style.
  const autoFit = useRef(true);
  const [fitted, setFitted] = useState(true);
  const setAutoFit = useCallback((on: boolean) => {
    autoFit.current = on;
    setFitted(on);
  }, []);

  const fitScale = useCallback(() => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    if (!vp || !el || el.offsetWidth === 0) return 1;
    // The 1px spare absorbs the rounding in offsetWidth/Height (the content is
    // fractional), which could otherwise overflow a fitted stage by a hair.
    const s = Math.min((vp.clientWidth - PAD * 2 - 1) / el.offsetWidth, (vp.clientHeight - PAD * 2 - 1) / el.offsetHeight, 1.5);
    return Math.max(0.01, s);
  }, []);

  // Track the unscaled content size and refit while in auto-fit mode.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    if (!vp || !el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
      if (autoFit.current) setScale(fitScale());
    });
    ro.observe(vp);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitScale]);

  // A new glyph or stage gets a fresh fit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey is the trigger
  useEffect(() => {
    setAutoFit(true);
    setScale(fitScale());
  }, [contentKey, fitScale, setAutoFit]);

  const zoomBy = useCallback(
    (factor: number) => {
      setAutoFit(false);
      const vp = viewportRef.current;
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
        if (vp) {
          const ratio = next / prev;
          const vw = vp.clientWidth;
          const vh = vp.clientHeight;
          requestAnimationFrame(() => {
            vp.scrollLeft = (vp.scrollLeft + vw / 2) * ratio - vw / 2;
            vp.scrollTop = (vp.scrollTop + vh / 2) * ratio - vh / 2;
          });
        }
        return next;
      });
    },
    [setAutoFit],
  );

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0025));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const fit = useCallback(() => {
    setAutoFit(true);
    setScale(fitScale());
  }, [setAutoFit, fitScale]);
  const actualSize = useCallback(() => {
    setAutoFit(false);
    setScale(1);
  }, [setAutoFit]);

  useShortcuts((key) => {
    if (key === '+' || key === '=') zoomBy(1.25);
    else if (key === '-' || key === '_') zoomBy(1 / 1.25);
    else if (key === '0') fit();
    else return false;
    return true;
  });

  const btn =
    'inline-flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

  return (
    <div className="relative min-h-24 flex-1">
      <div ref={viewportRef} className={cx('studio-canvas studio-scroll absolute inset-0', fitted ? 'overflow-hidden' : 'overflow-auto')}>
        <div
          className="flex items-center justify-center"
          style={{ width: size.w * scale + PAD * 2, height: size.h * scale + PAD * 2, minWidth: '100%', minHeight: '100%' }}
        >
          <div style={{ width: size.w * scale, height: size.h * scale }}>
            <div ref={contentRef} className="w-max origin-top-left" style={{ transform: `scale(${scale})` }}>
              {children}
            </div>
          </div>
        </div>
      </div>
      {overlay && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{overlay}</div>}
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/90 p-0.5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.25)} title="Zoom out (−)" aria-label="Zoom out">
          <MinusIcon size={14} />
        </button>
        <button
          type="button"
          className="h-7 min-w-12 rounded-md px-1 font-mono text-[11px] text-zinc-500 tabular-nums hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          onClick={actualSize}
          title="Reset to 100%"
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className={btn} onClick={() => zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">
          <ZoomInIcon size={14} />
        </button>
        <button type="button" className={btn} onClick={fit} title="Fit to view (0)" aria-label="Fit to view">
          <FitIcon size={14} />
        </button>
      </div>
    </div>
  );
}
