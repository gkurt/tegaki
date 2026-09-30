import { describe, expect, test } from 'bun:test';
import { DEFAULT_EFFECTS_STATE } from '../url-state.ts';
import { buildInkStyle, inkStyleProps } from './utils.ts';

const glowing = { ...DEFAULT_EFFECTS_STATE, glow: { ...DEFAULT_EFFECTS_STATE.glow, enabled: true, radius: 12, offsetY: 3 } };

describe('the Style tab as renderer props', () => {
  test("a glow's px sliders reach the plugin as px lengths, not as its em", () => {
    expect(inkStyleProps(glowing, []).plugins).toEqual([['glow', { radius: '12px', color: '#00ccff', offsetY: '3px' }]]);
  });

  test('another glow layer is a second glow plugin, after the first', () => {
    const layer = { key: 'glow2', effect: 'glow' as const, enabled: true, config: { radius: 20, color: '#f00', offsetX: 0, offsetY: 0 } };
    const { plugins } = buildInkStyle(glowing, [layer]);
    expect(plugins.map((p) => p.name)).toEqual(['glow', 'glow']);
  });
});
