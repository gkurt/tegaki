import 'dialkit/styles.css';
import { ColorControl, Slider, Toggle } from 'dialkit';
import { createContext, type ReactNode, useContext } from 'react';
import { DiceIcon, MinusIcon, PlusIcon } from '../icons.tsx';
import { MAX_SEED, rollSeed } from '../seed.ts';
import { cx, InfoTip } from '../ui.tsx';

export const DialThemeContext = createContext<'light' | 'dark'>('light');

/**
 * DialKit's controls read their look from CSS variables on the nearest
 * `.dialkit-root`, and portal their dropdowns into it — so every group of
 * controls sits in one, themed like the page.
 */
export function DialScope({ children, className }: { children: ReactNode; className?: string }) {
  const theme = useContext(DialThemeContext);
  return (
    <div className={cx('dialkit-root studio-dial', className)} data-theme={theme}>
      {children}
    </div>
  );
}

/** A switch that reveals its nested controls while on — the pattern every effect uses. `info` goes in a tooltip by its label. */
export function ToggleGroup({
  label,
  checked,
  onChange,
  children,
  trailing,
  info,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
  trailing?: ReactNode;
  info?: ReactNode;
}) {
  // DialKit types the label as a string, but renders it as it is: the ⓘ sits right after the name.
  const title = info ? (
    <>
      {label}
      <InfoTip label={`About ${label}`}>{info}</InfoTip>
    </>
  ) : (
    label
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Toggle label={title as string} checked={checked} onChange={onChange} />
        </div>
        {trailing}
      </div>
      {checked && children && (
        <div className="ml-2 flex flex-col gap-1.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">{children}</div>
      )}
    </div>
  );
}

export function ColorStops({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {colors.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <ColorControl
              label={`Stop ${i + 1}`}
              value={c}
              onChange={(v) => {
                const next = [...colors];
                next[i] = v;
                onChange(next);
              }}
            />
          </div>
          <SmallIconButton label="Remove stop" disabled={colors.length <= 2} onClick={() => onChange(colors.filter((_, j) => j !== i))}>
            <MinusIcon size={12} />
          </SmallIconButton>
        </div>
      ))}
      <AddRowButton onClick={() => onChange([...colors, '#888888'])}>Add stop</AddRowButton>
    </div>
  );
}

const SMALL_ICON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

export function SmallIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={SMALL_ICON}>
      {children}
    </button>
  );
}

/** A {@link SmallIconButton} that opens a link in a new tab. */
export function SmallIconLink({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} className={SMALL_ICON}>
      {children}
    </a>
  );
}

export function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 text-[12px] font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
    >
      <PlusIcon size={12} />
      {children}
    </button>
  );
}

/**
 * The renderer's seed: a slider to scrub through versions of the text, and a
 * die for a new one. What it changes is whatever draws with randomness — the
 * wobble, a gradient's hue, the variation plugin.
 */
export function SeedControl({ value, onChange }: { value: number; onChange: (seed: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <Slider label="Seed" value={value} min={0} max={Math.max(MAX_SEED, value)} step={1} onChange={onChange} />
      </div>
      <SmallIconButton label="New seed" onClick={() => onChange(rollSeed(value))}>
        <DiceIcon size={14} />
      </SmallIconButton>
    </div>
  );
}
