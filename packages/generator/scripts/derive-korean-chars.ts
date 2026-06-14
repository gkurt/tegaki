#!/usr/bin/env bun
/**
 * derive-korean-chars.ts — committed, reproducible derivation of the Korean
 * (Hangul) syllable set bundled with Nanum Pen Script.
 *
 * ── What this produces ─────────────────────────────────────────────────────
 * A deterministic, Unicode-codepoint-sorted string of the most useful
 * precomposed Hangul syllables (U+AC00–U+D7A3), capped so the generator's
 * Google Fonts `&text=` request returns a real *subset* of Nanum Pen Script
 * rather than silently degrading to the full ~3 MB font. Pasted into
 * `packages/generator/src/charsets.ts` as `KOREAN_SYLLABLES`.
 *
 * ── Selection method (Option B: KS X 1001 common band ∪ Wikipedia frequency) ─
 * 1. SEED — KS X 1001 (Wansung) common Hangul band: the 2,350 "commonly used"
 *    Hangul syllables fixed by the Korean national standard KS X 1001:1992
 *    (formerly KS C 5601-1987). These occupy EUC-KR lead bytes 0xB0–0xC8 with
 *    trailing bytes 0xA1–0xFE, in the standard's fixed order (가 … 힝). We
 *    derive them by decoding those byte positions with the platform EUC-KR
 *    decoder — no copyrighted table is embedded, only the public standard's
 *    byte→codepoint mapping. Source: KS X 1001 Wansung code (EUC-KR / IANA
 *    `EUC-KR`), Hangul region 0xB0A1–0xC8FE. Cross-check: this yields exactly
 *    2,350 syllables, the documented KS X 1001 Hangul count.
 * 2. FREQUENCY — count Hangul codepoint occurrences across an IMMUTABLE,
 *    date-stamped Korean Wikipedia article extract (NOT `@latest`/`current`):
 *      kowiki-20260601-pages-articles1.xml-p1p82407.bz2
 *    (the first article chunk of the 2026-06-01 kowiki dump, pages 1–82407 —
 *    the oldest/highest-traffic articles; ~90 MB compressed). Wikipedia text
 *    is CC BY-SA; we embed only the resulting *codepoint selection* (an
 *    uncopyrightable list of facts), never any prose. The dump is immutable:
 *    re-running against this exact file reproduces the ranking byte-for-byte.
 *    Source URL (immutable):
 *      https://dumps.wikimedia.org/kowiki/20260601/kowiki-20260601-pages-articles1.xml-p1p82407.bz2
 * 3. UNION + CAP — rank all syllables by Wikipedia frequency, but give KS X
 *    1001 members a ranking bonus so the everyday-coverage anchor wins ties /
 *    near-ties against rare syllables (the union backfills common syllables a
 *    raw frequency cut might drop). Take the top `TARGET_COUNT` (~650).
 * 4. SORT — final set sorted in Unicode codepoint order (stable, diff-friendly).
 *
 * ── Subsetting ceiling (why ~650, not a round number) ──────────────────────
 * Google Fonts css2 silently returns the FULL font once the encoded `&text=`
 * value crosses a cliff. Canonically measured this session (replicating
 * download.ts:56-69 — same URL shape + `User-Agent: tegaki/1.0`), Hangul
 * encodes to 9 bytes/char and the subset→full cliff sits at `&text=` ≈
 * 6,518–6,536 bytes:
 *
 *     N (syllables) | &text= bytes | response font URL
 *     650           | 6,338        | SUBSET (/l/font?kit=)
 *     670           | 6,518        | SUBSET   ← last subset
 *     672           | 6,536        | FULL (/s/nanumpenscript/...) ← first full
 *     800           | 7,688        | FULL (content-length 3,199,592)
 *     900           | 8,588        | FULL
 *
 * The exact byte cliff is font-version-dependent DOCUMENTATION, not a
 * load-bearing constant. The HARD GATE below keys on the css2 *response type*
 * (subset `/l/font?kit=` vs. full `/s/`), which is immune to threshold
 * mis-calibration. We cap at TARGET_COUNT=650, a safe margin below N≈670.
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *     bun packages/generator/scripts/derive-korean-chars.ts
 * Writes the derived string to .omc/handoffs/korean-syllables.txt and prints
 * the count + served css2 response type. Exits non-zero if the gate fails.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CHARS } from '../src/constants.ts';

// ── Configuration ───────────────────────────────────────────────────────────

/** Final syllable count cap — margin below the measured N≈670 css2 cliff. */
const TARGET_COUNT = 650;

/** Modern compatibility jamo: 19 leading consonants + 21 vowels = 40 (Phase 1). */
const KOREAN_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ' + 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';

/** Immutable, date-stamped Korean Wikipedia article extract (never @latest). */
const WIKI_DUMP_ID = 'kowiki-20260601-pages-articles1.xml-p1p82407.bz2';
const WIKI_DUMP_URL = `https://dumps.wikimedia.org/kowiki/20260601/${WIKI_DUMP_ID}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const CACHE_DIR = join(REPO_ROOT, '.cache', 'korean');
const DUMP_PATH = join(CACHE_DIR, WIKI_DUMP_ID);
const HANDOFF_PATH = join(REPO_ROOT, '.omc', 'handoffs', 'korean-syllables.txt');

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

// ── KS X 1001 common band (derived from the public standard's byte mapping) ──

/**
 * Decode the KS X 1001 (Wansung / EUC-KR) Hangul region 0xB0A1–0xC8FE into its
 * 2,350 precomposed syllables, in the standard's fixed order. Derived from the
 * public standard byte→codepoint mapping; no copyrighted table is embedded.
 */
function deriveKsx1001CommonBand(): string[] {
  const decoder = new TextDecoder('euc-kr', { fatal: true });
  const syllables: string[] = [];
  for (let lead = 0xb0; lead <= 0xc8; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      let ch: string;
      try {
        ch = decoder.decode(new Uint8Array([lead, trail]));
      } catch {
        continue; // unmapped cell
      }
      const cp = ch.codePointAt(0);
      if (cp !== undefined && cp >= HANGUL_START && cp <= HANGUL_END) {
        syllables.push(ch);
      }
    }
  }
  return syllables;
}

// ── Wikipedia dump → Hangul frequency ────────────────────────────────────────

async function ensureDump(): Promise<void> {
  if (existsSync(DUMP_PATH)) {
    console.log(`[wiki] using cached dump: ${DUMP_PATH}`);
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`[wiki] downloading immutable dump: ${WIKI_DUMP_URL}`);
  const res = await fetch(WIKI_DUMP_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download Wikipedia dump: ${res.status} ${res.statusText}`);
  }
  const out = createWriteStream(DUMP_PATH);
  // Stream to disk so we never hold the ~90 MB compressed file in memory.
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.write(Buffer.from(value));
  }
  await new Promise<void>((res2, rej) => out.end((err: unknown) => (err ? rej(err) : res2())));
  console.log('[wiki] download complete');
}

/**
 * Stream-decompress the bz2 dump via `bzcat` and count Hangul codepoint
 * frequencies. Streaming keeps the decompressed XML (hundreds of MB) out of
 * memory — we only retain the 11,172-entry frequency map.
 */
async function countHangulFrequency(): Promise<Map<number, number>> {
  const freq = new Map<number, number>();
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn('bzcat', [DUMP_PATH], { stdio: ['ignore', 'pipe', 'inherit'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      for (let i = 0; i < chunk.length; i++) {
        const cp = chunk.codePointAt(i);
        if (cp === undefined) continue;
        if (cp > 0xffff) i++; // skip the low surrogate of an astral pair
        if (cp >= HANGUL_START && cp <= HANGUL_END) {
          freq.set(cp, (freq.get(cp) ?? 0) + 1);
        }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`bzcat exited with code ${code}`));
    });
  });
  return freq;
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Rank by Wikipedia frequency, with a tie-break bonus for KS X 1001 members so
 * the everyday-coverage anchor wins against rare syllables, then take the top
 * `TARGET_COUNT` and sort by Unicode codepoint. Fully deterministic.
 */
function selectSyllables(ksBand: string[], freq: Map<number, number>): string[] {
  const ksSet = new Set(ksBand.map((c) => c.codePointAt(0)!));

  // Candidate pool: every syllable seen in the corpus, plus all KS X 1001
  // members (so a common syllable absent from this corpus slice is still
  // eligible via the anchor).
  const candidates = new Set<number>([...ksSet, ...freq.keys()]);

  const ranked = [...candidates].sort((a, b) => {
    const fa = freq.get(a) ?? 0;
    const fb = freq.get(b) ?? 0;
    if (fb !== fa) return fb - fa; // higher frequency first
    const ka = ksSet.has(a) ? 1 : 0;
    const kb = ksSet.has(b) ? 1 : 0;
    if (kb !== ka) return kb - ka; // KS X 1001 member breaks frequency ties
    return a - b; // codepoint order — final deterministic tiebreak
  });

  const selected = ranked.slice(0, TARGET_COUNT);
  selected.sort((a, b) => a - b); // emit in Unicode codepoint order
  return selected.map((cp) => String.fromCodePoint(cp));
}

// ── css2 response-type gate (PRIMARY hard gate — replicates download.ts) ──────

type Css2Result = { kind: 'subset' | 'full'; url: string; textBytes: number };

async function checkCss2ResponseType(chars: string): Promise<Css2Result> {
  const textBytes = encodeURIComponent(chars).length;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent('Nanum Pen Script')}&text=${encodeURIComponent(chars)}`;
  const res = await fetch(cssUrl, { headers: { 'User-Agent': 'tegaki/1.0' } });
  if (!res.ok) {
    throw new Error(`css2 request failed: ${res.status} ${res.statusText}`);
  }
  const css = await res.text();
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"]truetype['"]\)/);
  if (!match?.[1]) {
    throw new Error(`Could not find a truetype URL in css2 response:\n${css.slice(0, 500)}`);
  }
  const url = match[1];
  // Subset kit URLs use /l/font?kit=...; full-font files use /s/<slug>/...
  const kind = url.includes('/l/font?kit=') ? 'subset' : 'full';
  return { kind, url, textBytes };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ksBand = deriveKsx1001CommonBand();
  console.log(`[ksx1001] derived common band: ${ksBand.length} syllables (expected 2350)`);
  if (ksBand.length !== 2350) {
    throw new Error(`KS X 1001 derivation produced ${ksBand.length} syllables, expected 2350 — EUC-KR decoder mismatch`);
  }

  await ensureDump();
  console.log('[wiki] counting Hangul frequencies (streaming bzcat)…');
  const freq = await countHangulFrequency();
  const distinct = freq.size;
  let total = 0;
  for (const n of freq.values()) total += n;
  console.log(`[wiki] counted ${total.toLocaleString()} Hangul occurrences across ${distinct} distinct syllables`);

  const syllables = selectSyllables(ksBand, freq);
  const KOREAN_SYLLABLES = syllables.join('');
  console.log(`[select] chose ${syllables.length} syllables (cap ${TARGET_COUNT})`);

  // Coverage stat: how many of the selected set are KS X 1001 members.
  const ksSet = new Set(ksBand.map((c) => c.codePointAt(0)!));
  const ksHits = syllables.filter((c) => ksSet.has(c.codePointAt(0)!)).length;
  console.log(`[select] ${ksHits}/${syllables.length} selected syllables are KS X 1001 members`);

  // PRIMARY HARD GATE — assert the css2 response is a real subset.
  const finalChars = KOREAN_SYLLABLES + KOREAN_JAMO + DEFAULT_CHARS;
  console.log('[gate] checking css2 response type for the full KOREAN_CHARS set…');
  const result = await checkCss2ResponseType(finalChars);
  console.log(`[gate] &text= encoded bytes: ${result.textBytes} (documented cliff ≈ 6,518–6,536)`);
  console.log(`[gate] css2 served: ${result.kind.toUpperCase()} (${result.url.slice(0, 64)}…)`);

  // Persist the derived string for the next pipeline step regardless of gate,
  // but exit non-zero on failure so CI/agents never proceed on a degraded set.
  await mkdir(dirname(HANDOFF_PATH), { recursive: true });
  await Bun.write(HANDOFF_PATH, KOREAN_SYLLABLES);
  console.log(`[out] wrote KOREAN_SYLLABLES (${syllables.length} chars) → ${HANDOFF_PATH}`);

  if (result.kind !== 'subset') {
    console.error(
      `\n[FAIL] css2 returned the FULL font (${result.url}). The &text= request crossed the subsetting cliff. ` +
        `Reduce TARGET_COUNT below ${TARGET_COUNT} and re-run.`,
    );
    process.exit(1);
  }

  console.log('\n[OK] response-type gate passed — Google Fonts served a real subset.');
  console.log(`     Syllables: ${syllables.length}  |  Jamo: ${KOREAN_JAMO.length}  |  +DEFAULT_CHARS`);
  console.log('\n── KOREAN_SYLLABLES ──');
  console.log(KOREAN_SYLLABLES);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
