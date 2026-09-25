import { describe, expect, test } from 'bun:test';
import { FRAME_STEP, playbackShortcut, shortcutKey } from './shortcuts.ts';

const press = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing', boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  ...mods,
});

describe('shortcutKey', () => {
  test('letters are case-insensitive, so Caps Lock or Shift still switch modes', () => {
    expect(shortcutKey(press('T'))).toBe('t');
  });

  test('the space bar is named Space', () => {
    expect(shortcutKey(press(' '))).toBe('Space');
  });

  test('⌘/Ctrl/Alt chords belong to the browser — ⌘T is a new tab, not Text mode', () => {
    expect(shortcutKey(press('t', { metaKey: true }))).toBeNull();
    expect(shortcutKey(press('t', { ctrlKey: true }))).toBeNull();
    expect(shortcutKey(press('t', { altKey: true }))).toBeNull();
  });

  test('a key typed mid IME composition is not a shortcut', () => {
    expect(shortcutKey(press('g', { isComposing: true }))).toBeNull();
  });
});

describe('playbackShortcut', () => {
  const transport = (time: number, duration = 2) => {
    const calls: (number | 'toggle')[] = [];
    return {
      calls,
      p: { time, duration, playPause: () => calls.push('toggle'), seek: (t: number) => calls.push(t) },
    };
  };

  test('Space toggles playback', () => {
    const { calls, p } = transport(1);
    expect(playbackShortcut('Space', { shiftKey: false }, p)).toBe(true);
    expect(calls).toEqual(['toggle']);
  });

  test('Home and End jump to the ends of the timeline', () => {
    const { calls, p } = transport(1);
    playbackShortcut('Home', { shiftKey: false }, p);
    playbackShortcut('End', { shiftKey: false }, p);
    expect(calls).toEqual([0, 2]);
  });

  test('"." steps one frame; Shift (or the ">" it types) steps ten', () => {
    const { calls, p } = transport(1);
    playbackShortcut('.', { shiftKey: false }, p);
    playbackShortcut('.', { shiftKey: true }, p);
    playbackShortcut('>', { shiftKey: true }, p);
    expect(calls).toEqual([1 + FRAME_STEP, 1 + 10 * FRAME_STEP, 1 + 10 * FRAME_STEP]);
  });

  test('stepping stops at the ends instead of seeking out of the timeline', () => {
    const { calls, p } = transport(0.01);
    playbackShortcut('<', { shiftKey: true }, p);
    const end = transport(1.99);
    playbackShortcut('>', { shiftKey: true }, end.p);
    expect([...calls, ...end.calls]).toEqual([0, 2]);
  });

  test('with nothing to play, the keys are left alone — Space still scrolls or clicks', () => {
    const { calls, p } = transport(0, 0);
    expect(playbackShortcut('Space', { shiftKey: false }, p)).toBe(false);
    expect(calls).toEqual([]);
  });

  test('other keys are not playback keys', () => {
    expect(playbackShortcut('t', { shiftKey: false }, transport(1).p)).toBe(false);
  });
});
