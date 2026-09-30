import { describe, expect, test } from 'bun:test';
import { captionPlugin, captionSlots, captionTimes, captionWords, parseCues, parseTime, spokenLength } from './caption.ts';
import { EM, strokesOf } from './testStrokes.ts';

describe('parseCues', () => {
  test('lines of start, end and word', () => {
    expect(parseCues('0 0.4 Hello\n0.6 1.2 world')).toEqual([
      { start: 0, end: 0.4, text: 'Hello' },
      { start: 0.6, end: 1.2, text: 'world' },
    ]);
  });

  test('cues split by semicolons, as ranges, or with only a start', () => {
    expect(parseCues('0-0.5 a; 0.7 b; 1:02.5')).toEqual([{ start: 0, end: 0.5, text: 'a' }, { start: 0.7, text: 'b' }, { start: 62.5 }]);
  });

  test('a line of bare times is a start per word', () => {
    expect(parseCues('0 0.5 1 1.5')).toEqual([{ start: 0 }, { start: 0.5 }, { start: 1 }, { start: 1.5 }]);
  });

  test("a transcriber's JSON word list", () => {
    expect(parseCues('[{"word":"hi","start":0.1,"end":0.4},{"startTime":0.5},[1,1.5],{"nope":1}]')).toEqual([
      { start: 0.1, end: 0.4, text: 'hi' },
      { start: 0.5 },
      { start: 1, end: 1.5 },
    ]);
  });

  test('nothing, or what it can’t read, is no cues', () => {
    expect(parseCues('')).toEqual([]);
    expect(parseCues('[oops')).toEqual([]);
    expect(parseCues('hello there')).toEqual([]);
  });

  test('times in seconds, minutes and hours', () => {
    expect(parseTime('1.25')).toBe(1.25);
    expect(parseTime('2:03')).toBe(123);
    expect(parseTime('1:00:00.5')).toBe(3600.5);
    expect(parseTime('abc')).toBeNull();
  });
});

describe('caption timing', () => {
  const strokes = strokesOf('ab cd');

  test('each word is written in its cue, its strokes keeping their order and share', () => {
    const words = captionWords(strokes, EM);
    const cues = parseCues('1 2; 3 3.5');
    const times = captionTimes(strokes, words, captionSlots(words, cues, { lead: 0, wpm: 140 }), 'stretch');
    expect(times[0]!.start).toBeCloseTo(1);
    // The word's writing fills its second, less a breath before the next.
    expect(times[1]!.start + times[1]!.duration).toBeCloseTo(1.92);
    expect(times[2]!.start).toBeCloseTo(3);
    expect(times[3]!.start + times[3]!.duration).toBeCloseTo(3 + 0.5 * 0.92);
  });

  test('at its own pace a word takes its own time, unless its cue is shorter', () => {
    const words = captionWords(strokes, EM);
    const times = captionTimes(strokes, words, captionSlots(words, parseCues('1 5; 5.1 5.2'), { lead: 0, wpm: 140 }), 'pace');
    expect(times[1]!.start + times[1]!.duration - times[0]!.start).toBeCloseTo(0.4);
    expect(times[3]!.start + times[3]!.duration - times[2]!.start).toBeCloseTo(0.1 * 0.92);
  });

  test('lead moves the writing against the voice', () => {
    const words = captionWords(strokes, EM);
    const slots = captionSlots(words, parseCues('1 2; 3 3.5'), { lead: -0.25, wpm: 140 });
    expect(slots.map((s) => s.start)).toEqual([0.75, 2.75]);
  });

  test('words with no cue follow on at a speaking pace, the last cue’s end first', () => {
    const words = captionWords(strokesOf('ab cd ef'), EM);
    const slots = captionSlots(words, parseCues('1 2'), { lead: 0, wpm: 120 });
    expect(slots[1]!.start).toBeCloseTo(2);
    expect(slots[2]!.start).toBeCloseTo(2 + spokenLength(words[1]!, 120));
  });

  test('a full stop leaves a longer pause than a comma, and a comma than none', () => {
    const say = (last: string) => spokenLength({ length: 4, last }, 140);
    expect(say('.')).toBeGreaterThan(say(','));
    expect(say(',')).toBeGreaterThan(say('a'));
  });

  test('the plugin retimes every stroke, and nothing when the text draws nothing', () => {
    const plugin = captionPlugin({ cues: '0 1; 2 3' });
    const out = plugin.timing!({ strokes, duration: 0.8, fontSize: EM, random: () => Math.random });
    expect(out!.strokes).toHaveLength(4);
    expect(out!.strokes[2]!.start).toBeCloseTo(2);
    expect(plugin.timing!({ strokes: [], duration: 0, fontSize: EM, random: () => Math.random })).toBeUndefined();
  });
});
