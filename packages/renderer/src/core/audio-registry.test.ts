import { afterEach, describe, expect, test } from 'bun:test';
import type { Timeline } from '../lib/timeline.ts';
import type { TegakiBundle } from '../types.ts';
import { getAudio, listAudio, registerAudio, type TegakiAudioDriver, type TegakiAudioInstance, unregisterAudio } from './audio-registry.ts';
import { AudioRuntime, resolveSoundProp } from './audio-runtime.ts';

/** Capture every event the driver receives so tests can assert on order/payload. */
type Event = { kind: 'start' | 'end' | 'tick' | 'silence' | 'destroy'; id?: number; activeCount?: number };

function recordingDriver(name: string, events: Event[], baseConfig?: Record<string, unknown>): TegakiAudioDriver {
  return {
    name,
    create(_ctx, config) {
      Object.assign(baseConfig ?? {}, config);
      const inst: TegakiAudioInstance = {
        onStrokeStart(info) {
          events.push({ kind: 'start', id: info.id });
        },
        onStrokeEnd(info) {
          events.push({ kind: 'end', id: info.id });
        },
        onTick(activeCount) {
          events.push({ kind: 'tick', activeCount });
        },
        silence() {
          events.push({ kind: 'silence' });
        },
        destroy() {
          events.push({ kind: 'destroy' });
        },
      };
      return inst;
    },
  };
}

describe('registerAudio / getAudio', () => {
  afterEach(() => {
    registerAudio(null);
  });

  test('registers and retrieves a driver by name', () => {
    const drv = recordingDriver('pencil', []);
    registerAudio(drv);
    expect(getAudio('pencil')).toBe(drv);
    expect(listAudio()).toEqual(['pencil']);
  });

  test('supports multiple drivers side-by-side', () => {
    registerAudio(recordingDriver('pencil', []));
    registerAudio(recordingDriver('chalk', []));
    registerAudio(recordingDriver('brush', []));
    expect(listAudio().sort()).toEqual(['brush', 'chalk', 'pencil']);
  });

  test('re-registering replaces the previous driver — second registration wins', () => {
    const first = recordingDriver('pencil', []);
    const second = recordingDriver('pencil', []);
    registerAudio(first);
    registerAudio(second);
    expect(getAudio('pencil')).toBe(second);
  });

  test('registerAudio(null) clears every driver — useful for tests', () => {
    registerAudio(recordingDriver('pencil', []));
    registerAudio(recordingDriver('chalk', []));
    registerAudio(null);
    expect(listAudio()).toEqual([]);
  });

  test('unregisterAudio drops a single driver by name', () => {
    registerAudio(recordingDriver('pencil', []));
    registerAudio(recordingDriver('chalk', []));
    expect(unregisterAudio('pencil')).toBe(true);
    expect(unregisterAudio('pencil')).toBe(false);
    expect(listAudio()).toEqual(['chalk']);
  });
});

describe('resolveSoundProp', () => {
  afterEach(() => {
    registerAudio(null);
  });

  test('returns null for falsy props — false/null/undefined disable audio', () => {
    expect(resolveSoundProp(false)).toBeNull();
    expect(resolveSoundProp(null)).toBeNull();
    expect(resolveSoundProp(undefined)).toBeNull();
  });

  test('resolves a registered driver by string name', () => {
    const drv = recordingDriver('pencil', []);
    registerAudio(drv);
    const resolved = resolveSoundProp('pencil');
    expect(resolved?.driver).toBe(drv);
    expect(resolved?.volume).toBe(1);
  });

  test('object form passes through volume + extra config, strips the name field', () => {
    const drv = recordingDriver('chalk', []);
    registerAudio(drv);
    const resolved = resolveSoundProp({ name: 'chalk', volume: 0.3, grainRate: 80 });
    expect(resolved?.driver).toBe(drv);
    expect(resolved?.volume).toBe(0.3);
    expect(resolved?.config).toEqual({ grainRate: 80 });
  });

  test('a raw driver object bypasses the registry — useful for one-off custom drivers', () => {
    const drv = recordingDriver('custom', []);
    const resolved = resolveSoundProp(drv);
    expect(resolved?.driver).toBe(drv);
  });

  test('unknown name returns null and warns once', () => {
    const warnings: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      expect(resolveSoundProp('nonexistent-driver-1')).toBeNull();
      expect(resolveSoundProp('nonexistent-driver-1')).toBeNull();
      expect(warnings.length).toBe(1); // de-duped across calls
    } finally {
      console.warn = origWarn;
    }
  });
});

// =========================================================================
// AudioRuntime — exercise stroke-event scheduling without a real AudioContext.
// `setSound` short-circuits when there's no `window.AudioContext`, which means
// we can't drive the runtime end-to-end here. Instead we test the pure logic:
// resolving the prop and rebuilding strokes.
// =========================================================================

function bundle(): TegakiBundle {
  return {
    family: 'test',
    lineCap: 'round',
    fontUrl: '',
    fontFaceCSS: '',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphData: {
      A: {
        w: 500,
        t: 1,
        s: [
          {
            p: [
              [0, 0, 50],
              [10, 10, 50],
            ],
            d: 0,
            a: 0.5,
          },
          {
            p: [
              [0, 0, 80],
              [10, 10, 80],
            ],
            d: 0.5,
            a: 0.5,
          },
        ],
      },
    },
  };
}

function timelineFor(): Timeline {
  return {
    totalDuration: 1,
    entries: [{ char: 'A', graphemeIndex: 0, offset: 0, duration: 1, hasGlyph: true }],
  };
}

describe('AudioRuntime.rebuildStrokes', () => {
  test('produces one event per glyph stroke with correct timing and CSS-px widths', () => {
    const rt = new AudioRuntime();
    rt.rebuildStrokes(timelineFor(), bundle(), 100);
    // 100 / 1000 unitsPerEm = 0.1 scale; widths become 5 and 8 px.
    const events = (rt as unknown as { _strokes: { startTime: number; endTime: number; width: number }[] })._strokes;
    expect(events).toHaveLength(2);
    expect(events[0]!.startTime).toBe(0);
    expect(events[0]!.endTime).toBe(0.5);
    expect(events[0]!.width).toBeCloseTo(5);
    expect(events[1]!.startTime).toBe(0.5);
    expect(events[1]!.endTime).toBe(1);
    expect(events[1]!.width).toBeCloseTo(8);
  });

  test('handles strokeTimeScale by scaling both delay and duration', () => {
    const rt = new AudioRuntime();
    const tl: Timeline = {
      totalDuration: 2,
      entries: [{ char: 'A', graphemeIndex: 0, offset: 0, duration: 2, hasGlyph: true, strokeTimeScale: 2 }],
    };
    rt.rebuildStrokes(tl, bundle(), 100);
    const events = (rt as unknown as { _strokes: { startTime: number; endTime: number }[] })._strokes;
    expect(events[1]!.startTime).toBe(1); // 0.5 * 2
    expect(events[1]!.endTime).toBe(2); // 0.5 * 2 + 0.5 * 2
  });

  test('honours per-entry strokeDelays overrides — used by dot deferral', () => {
    const rt = new AudioRuntime();
    const tl: Timeline = {
      totalDuration: 1,
      entries: [
        {
          char: 'A',
          graphemeIndex: 0,
          offset: 0,
          duration: 1,
          hasGlyph: true,
          strokeDelays: [undefined, 0.8],
        },
      ],
    };
    rt.rebuildStrokes(tl, bundle(), 100);
    const events = (rt as unknown as { _strokes: { startTime: number }[] })._strokes;
    expect(events[1]!.startTime).toBe(0.8);
  });

  test('skips entries without glyph data — fallback chars have no audio', () => {
    const rt = new AudioRuntime();
    const tl: Timeline = {
      totalDuration: 1,
      entries: [
        { char: 'A', graphemeIndex: 0, offset: 0, duration: 1, hasGlyph: true },
        { char: '?', graphemeIndex: 1, offset: 1, duration: 0.2, hasGlyph: false },
      ],
    };
    rt.rebuildStrokes(tl, bundle(), 100);
    const events = (rt as unknown as { _strokes: unknown[] })._strokes;
    expect(events).toHaveLength(2); // just the two strokes from "A"
  });
});
