import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseFont } from '../commands/generate.ts';
import { DEFAULT_CHARS } from '../constants.ts';
import { buildGsubGraph, findFormExamples, glyphFormsOf } from './glyph-forms.ts';
import { createHbShaper } from './hb-shaper.ts';

const load = async (dir: string) => {
  const buffer = readFileSync(new URL(`../../../renderer/fonts/${dir}/${dir}.ttf`, import.meta.url)).buffer as ArrayBuffer;
  const info = await parseFont(buffer);
  return { info, graph: buildGsubGraph(info.font), shaper: await createHbShaper(buffer, info.features) };
};

const caveat = await load('caveat');
const amiri = await load('amiri');

describe('glyphFormsOf', () => {
  test("the character's own glyph comes first, as the default", () => {
    const [first] = glyphFormsOf(caveat.graph, 'a');
    expect(first).toMatchObject({ kind: 'default', gid: caveat.info.font.charToGlyphIndex('a'), text: 'a', features: [] });
  });

  test("Caveat's repeated-letter alternates are contextual calt forms of the letter", () => {
    const alternates = glyphFormsOf(caveat.graph, 'a').filter((f) => f.kind === 'alternate');
    expect(alternates.map((f) => f.name)).toEqual(['a.ss01', 'a.ss02']);
    for (const f of alternates) expect(f).toMatchObject({ features: ['calt'], contextual: true, text: 'a' });
  });

  test('a ligature is listed under each of its letters, with their text', () => {
    const fi = (char: string) => glyphFormsOf(caveat.graph, char).find((f) => f.name === 'f_i');
    expect(fi('f')).toMatchObject({ kind: 'ligature', text: 'fi', features: ['liga'], contextual: false });
    expect(fi('i')).toMatchObject({ kind: 'ligature', text: 'fi' });
  });

  test('ligatures come after alternates, shortest first', () => {
    const kinds = glyphFormsOf(caveat.graph, 'f').map((f) => `${f.kind}:${f.text}`);
    expect(kinds.indexOf('ligature:ff')).toBeGreaterThan(kinds.lastIndexOf('alternate:f'));
    expect(kinds.indexOf('ligature:ffi')).toBeGreaterThan(kinds.indexOf('ligature:ff'));
  });

  test('Arabic positional forms carry their feature', () => {
    const features = glyphFormsOf(amiri.graph, 'ب').map((f) => f.features.join(','));
    for (const tag of ['init', 'medi', 'fina']) expect(features).toContain(tag);
  });

  test('a character the font lacks has no forms', () => {
    expect(glyphFormsOf(caveat.graph, 'ب')).toEqual([]);
  });
});

describe('findFormExamples', () => {
  const examples = (char: string, words: string[] = []) => {
    const forms = glyphFormsOf(caveat.graph, char);
    const found = findFormExamples(forms, caveat.shaper.shape, { char, charset: [...DEFAULT_CHARS], words });
    return new Map(forms.map((f) => [f.name, found.get(f.gid)]));
  };

  test('the default glyph is drawn alone', () => {
    expect(examples('a').get('a')).toEqual({ text: 'a', cluster: 0 });
  });

  test("a repeated letter draws Caveat's alternates, located by cluster", () => {
    const found = examples('a');
    expect(found.get('a.ss01')).toEqual({ text: 'aa', cluster: 1 });
    expect(found.get('a.ss02')).toEqual({ text: 'aaa', cluster: 2 });
  });

  test('a ligature is drawn for its letters', () => {
    expect(examples('f').get('f_i')).toEqual({ text: 'fi', cluster: 0 });
  });

  test("Amiri's initial ب is found at the start of a word", () => {
    const forms = glyphFormsOf(amiri.graph, 'ب');
    const found = findFormExamples(forms, amiri.shaper.shape, { char: 'ب', charset: [...'بتثسمه'] });
    const init = forms.find((f) => f.features.join() === 'init')!;
    expect(found.get(init.gid)?.cluster).toBe(0);
  });

  test("forms the shaper never applies get no example (Italianno's init / fina on Latin text)", async () => {
    const italianno = await load('italianno');
    const forms = glyphFormsOf(italianno.graph, 'a');
    const found = findFormExamples(forms, italianno.shaper.shape, { char: 'a', charset: [...DEFAULT_CHARS] });
    expect(forms.map((f) => f.name)).toEqual(['a', 'a.init', 'a.fina']);
    expect([...found.keys()]).toEqual([forms[0]!.gid]);
  });
});
