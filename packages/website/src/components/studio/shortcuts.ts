import { useEffect, useRef } from 'react';

/**
 * The studio's keyboard shortcuts, as the help dialog lists them. Each is
 * handled where its state lives (Studio, the workspaces, ZoomStage) through
 * `useShortcuts`; keep this list in step with those handlers.
 */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string[][]; label: string }[] }[] = [
  {
    title: 'General',
    items: [
      { keys: [['T']], label: 'Text preview' },
      { keys: [['G']], label: 'Glyph inspector' },
      { keys: [['I']], label: 'Show / hide the inspector' },
      { keys: [['O']], label: 'Debug overlay' },
      { keys: [['?']], label: 'Keyboard shortcuts' },
    ],
  },
  {
    title: 'Playback',
    items: [
      { keys: [['Space']], label: 'Play / pause' },
      { keys: [['Home'], ['End']], label: 'Jump to start / end' },
      { keys: [[','], ['.']], label: 'Step back / forward a frame' },
      {
        keys: [
          ['Shift', ','],
          ['Shift', '.'],
        ],
        label: 'Step back / forward ten frames',
      },
    ],
  },
  {
    title: 'Glyphs',
    items: [
      { keys: [['←'], ['→']], label: 'Previous / next glyph' },
      { keys: [['['], [']']], label: 'Previous / next stage' },
      { keys: [['+'], ['−']], label: 'Zoom in / out' },
      { keys: [['0']], label: 'Fit to view' },
      { keys: [['1']], label: 'Zoom to 100%' },
    ],
  },
];

/** One playback step for `,` / `.` — a frame at 30 fps. */
export const FRAME_STEP = 1 / 30;

/**
 * The shortcut a key press names — `KeyboardEvent.key`, lower-cased for
 * letters, `Space` for the space bar — or null for a chord with ⌘/Ctrl/Alt
 * (those belong to the browser) or a key mid-IME-composition.
 */
export function shortcutKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing'>): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return null;
  if (e.key === ' ') return 'Space';
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);
/**
 * Keys a focused slider, list or menu moves itself with natively. (Radio
 * groups aren't here: a segmented control that arrows through its options
 * cancels the key itself, which the listener already respects.)
 */
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const NAV_OWNERS = 'input[type="range"], [role="slider"], [role="separator"], [role="listbox"], [role="menu"], select';
/**
 * Controls Space toggles or picks — where it isn't "play". A radio isn't: the
 * one Space would pick is the one already checked (by the click that focused it).
 */
const SPACE_OWNERS =
  'input[type="checkbox"], select, [role="checkbox"], [role="switch"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="combobox"]';

/**
 * Whether the focused element keeps this key for itself: anything typed
 * into, anything inside a popover or dialog (`data-shortcuts="off"`), the
 * arrows and Home/End of a slider or list, and Space on a checkbox, switch
 * or option. Space on a plain button still plays — only the click it would
 * repeat is lost, as in a video player.
 */
export function targetKeepsKey(key: string, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-shortcuts="off"]')) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) return true;
  if (NAV_KEYS.has(key)) return !!target.closest(NAV_OWNERS);
  if (key === 'Space') return !!target.closest(SPACE_OWNERS);
  return false;
}

/**
 * Listen for studio shortcuts. `onKey` gets the `shortcutKey` of each press
 * the focused element doesn't keep, and returns true when it handled it (the
 * browser's default — scrolling, a button click — is then cancelled).
 */
export function useShortcuts(onKey: (key: string, e: KeyboardEvent) => boolean | undefined, enabled = true) {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = shortcutKey(e);
      // A held Space would flicker play/pause; held arrows and steps repeat on purpose.
      if (!key || (e.repeat && key === 'Space') || targetKeepsKey(key, e.target)) return;
      if (handler.current(key, e)) e.preventDefault();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
}

/**
 * The playback keys — Space, Home/End, and `,`/`.` stepping (ten frames with
 * Shift, which some layouts report as `<`/`>`) — for a transport with a
 * seekable time. Seeking pauses, as dragging the scrubber does. Returns
 * whether the key was one of them.
 */
export function playbackShortcut(
  key: string,
  e: Pick<KeyboardEvent, 'shiftKey'>,
  p: { time: number; duration: number; playPause: () => void; seek: (t: number) => void },
): boolean {
  if (p.duration <= 0) return false;
  if (key === 'Space') p.playPause();
  else if (key === 'Home') p.seek(0);
  else if (key === 'End') p.seek(p.duration);
  else if (key === ',' || key === '.' || key === '<' || key === '>') {
    const frames = (key === ',' || key === '<' ? -1 : 1) * (e.shiftKey || key === '<' || key === '>' ? 10 : 1);
    p.seek(Math.min(p.duration, Math.max(0, p.time + frames * FRAME_STEP)));
  } else return false;
  return true;
}
