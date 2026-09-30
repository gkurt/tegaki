import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, InfoIcon, ResetIcon } from './icons.tsx';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Square icon-only toolbar button. */
export function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Pill-shaped segmented control. `compact` hides the labels below `sm` when every option has an icon. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  compact?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      className={cx('inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/80', className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
              selected
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {o.icon}
            <span className={cx(compact && !!o.icon && 'hidden sm:inline')}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Close a popover on outside pointer-down or Escape. */
export function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement | null>[]) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // Clicks inside a DialKit dropdown (portaled into the popover's root) count as inside.
      if (refs.some((r) => r.current?.contains(target))) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, refs]);
}

/**
 * Anchored popover. The panel is absolutely positioned under the trigger;
 * `align` picks which edge it hugs.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  open,
  onOpenChange,
  panelClassName,
  fullWidthOnMobile,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelClassName?: string;
  /** Below `sm`, drop the anchor and span the viewport under the top bar. */
  fullWidthOnMobile?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [refs] = useState(() => [rootRef]);
  useDismiss(open, () => onOpenChange(false), refs);
  return (
    <div ref={rootRef} className="relative min-w-0">
      {trigger({ open, toggle: () => onOpenChange(!open) })}
      {open && (
        <div
          // Keys pressed in a menu work the menu, not the studio's shortcuts.
          data-shortcuts="off"
          className={cx(
            'absolute top-full z-50 mt-1.5 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10',
            'dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40',
            align === 'start' ? 'left-0' : 'right-0',
            panelClassName,
            fullWidthOnMobile && 'max-sm:fixed max-sm:inset-x-2 max-sm:top-13 max-sm:w-auto',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Collapsible inspector section with an optional reset action. */
export function Section({
  title,
  children,
  defaultOpen = true,
  modified,
  onReset,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  modified?: boolean;
  onReset?: () => void;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex h-10 items-center gap-1 pr-2 pl-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
          {modified && <span className="size-1.5 shrink-0 rounded-full bg-indigo-500" title="Changed from default" />}
        </button>
        {actions}
        {modified && onReset && (
          <IconButton label={`Reset ${title.toLowerCase()}`} onClick={onReset} className="size-7">
            <ResetIcon size={14} />
          </IconButton>
        )}
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={() => setOpen(!open)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        >
          <ChevronDownIcon size={14} className={cx('transition-transform', !open && '-rotate-90')} />
        </button>
      </div>
      {open && <div className="flex flex-col gap-1.5 px-3 pb-4">{children}</div>}
    </section>
  );
}

/**
 * An ⓘ that shows `children` in a bubble below it — on hover or keyboard
 * focus, or a tap on touch screens. The bubble is portaled to the body so a
 * scrolling panel can't clip it, and kept inside the viewport.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ x: r.left + r.width / 2, y: r.bottom });
  };
  const hide = useCallback(() => setAt(null), []);
  useEffect(() => {
    if (!at) return;
    // The bubble is placed once, so it goes when what it's placed by moves.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && hide();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [at, hide]);
  const width = 240;
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={at ? id : undefined}
        className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 focus-visible:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 dark:focus-visible:text-zinc-200"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (at) hide();
          else show();
        }}
      >
        <InfoIcon size={12} />
      </button>
      {at &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] leading-snug font-normal text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
            style={{ width, left: Math.max(8, Math.min(at.x - width / 2, window.innerWidth - width - 8)), top: at.y + 6 }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Small caption row used between groups of controls. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{children}</p>;
}

/** Pill chip used for presets and feature tags. */
export function Chip({
  selected,
  onClick,
  onDoubleClick,
  children,
  title,
  mono,
  disabled,
}: {
  selected?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
  title?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cx(
        'h-6 rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors disabled:opacity-40',
        mono && 'font-mono',
        selected
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A glyph named in running text, set as a key cap rather than in quotes.
 * Tinted from the surrounding text colour, so it fits any status line; a
 * whitespace glyph shows as ␣ (its code point in the tooltip).
 */
export function GlyphKey({ char, className }: { char: string; className?: string }) {
  const blank = char.trim() === '';
  const code = `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    <kbd
      title={blank ? code : undefined}
      className={cx(
        'inline-flex h-[1.6em] min-w-[1.6em] items-center justify-center rounded border border-b-2 border-current/25 bg-current/5 px-1 font-sans leading-none font-medium not-italic',
        className,
      )}
    >
      {blank ? '␣' : char}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      aria-hidden="true"
    />
  );
}

/** Media-query hook (client-only page, so the initial read is safe). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** True while focus is in something that takes typed input — keyboard shortcuts stand down. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
