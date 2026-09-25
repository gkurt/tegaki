import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ResetIcon } from './icons.tsx';

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

/** Small caption row used between groups of controls. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{children}</p>;
}

/** Pill chip used for presets and feature tags. */
export function Chip({
  selected,
  onClick,
  children,
  title,
  mono,
  disabled,
}: {
  selected?: boolean;
  onClick: () => void;
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
