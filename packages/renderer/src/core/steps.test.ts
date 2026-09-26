import { describe, expect, mock, test } from 'bun:test';
import { StrokePath } from '../lib/strokePath.ts';
import type { StrokeGeometryContext } from '../lib/strokeTimeline.ts';
import { allPluginSteps, normalizeSteps, outlineWith, pluginStepsAt, reshapeWith, stepAt } from './plugins.ts';
import type { TegakiPlugin } from './types.ts';

const boil = (count: number, fps: number, name = 'boil'): TegakiPlugin => ({ name, steps: { count, fps } });

describe('normalizeSteps', () => {
  test('a count is made whole, and one drawing (or no fps) is nothing to cycle', () => {
    expect(normalizeSteps({ count: 3.7, fps: 12 })).toEqual({ count: 3, fps: 12, idle: false });
    expect(normalizeSteps({ count: 1, fps: 12 })).toBeNull();
    expect(normalizeSteps({ count: 3, fps: 0 })).toBeNull();
    expect(normalizeSteps({ count: 3, fps: Number.NaN })).toBeNull();
    expect(normalizeSteps(undefined)).toBeNull();
  });

  test('idle is on only when asked for', () => {
    expect(normalizeSteps({ count: 2, fps: 8, idle: true })!.idle).toBe(true);
  });
});

describe('stepAt', () => {
  const steps = { count: 3, fps: 12, idle: false };

  test('a new drawing every 1/fps seconds, round and round', () => {
    expect([0, 0.05, 1 / 12, 2 / 12, 3 / 12, 4 / 12].map((t) => stepAt(steps, t))).toEqual([0, 0, 1, 2, 0, 1]);
  });

  test('before the clock starts it shows the first', () => {
    expect(stepAt(steps, -5)).toBe(0);
  });
});

describe('pluginStepsAt', () => {
  test('each stepped plugin gets its own drawing, and the key names the combination', () => {
    const a = boil(3, 12, 'a');
    const b = boil(2, 4, 'b');
    const plain: TegakiPlugin = { name: 'plain' };
    const { steps, key } = pluginStepsAt([a, plain, b], 0.3);
    expect(steps.get(a)).toBe(0); // tick 3 of 3
    expect(steps.get(b)).toBe(1); // tick 1 of 2
    expect(steps.has(plain)).toBe(false);
    expect(key).toBe('0,1');
  });

  test('with no stepped plugins the key is empty', () => {
    expect(pluginStepsAt([{ name: 'plain' }], 5).key).toBe('');
  });
});

describe('allPluginSteps', () => {
  test('every combination of the drawings, for the canvas to hold', () => {
    const a = boil(3, 12, 'a');
    const b = boil(2, 4, 'b');
    const combos = allPluginSteps([a, b]);
    expect(combos).toHaveLength(6);
    expect(new Set(combos.map((c) => `${c.get(a)}${c.get(b)}`)).size).toBe(6);
  });

  test('without stepped plugins there is one combination, the plain drawing', () => {
    expect(allPluginSteps([{ name: 'plain' }])).toEqual([new Map()]);
  });

  test('more combinations than the limit are cut off', () => {
    expect(allPluginSteps([boil(8, 12, 'a'), boil(8, 12, 'b')], 10)).toHaveLength(10);
  });
});

describe('hooks are told their drawing', () => {
  test('geometry gets its own plugin’s step, and 0 without steps', () => {
    const seen: [string, number][] = [];
    const stepped: TegakiPlugin = {
      name: 'stepped',
      steps: { count: 3, fps: 12 },
      geometry: (p, g) => {
        seen.push(['stepped', g.step]);
        return p;
      },
    };
    const plain: TegakiPlugin = {
      name: 'plain',
      geometry: (p, g) => {
        seen.push(['plain', g.step]);
        return p;
      },
    };
    const reshape = reshapeWith([stepped, plain], { fontSize: 10, random: () => Math.random }, mock(), new Map([[stepped, 2]]))!;
    reshape(new StrokePath([{ x: 0, y: 0, width: 1, t: 0 }]), {} as StrokeGeometryContext);
    expect(seen).toEqual([
      ['stepped', 2],
      ['plain', 0],
    ]);
  });

  test('outline gets the same step as geometry', () => {
    let step = -1;
    const stepped: TegakiPlugin = {
      name: 'stepped',
      steps: { count: 3, fps: 12 },
      outline: (c, o) => {
        step = o.step;
        return [...c];
      },
    };
    outlineWith([stepped], mock(), new Map([[stepped, 1]]))!([], { place: { x: 0, y: 0, scale: 1, ascender: 0 }, seed: 0, fontSize: 10 });
    expect(step).toBe(1);
  });
});
