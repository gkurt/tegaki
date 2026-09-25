// Combining marks: an accent is written after its letter.
//
// The heuristic order runs top to bottom, so an accent — the highest ink of
// é, ô, ό — drew first. Dots already draw last (ordering.ts classifyDots),
// but an acute, a circumflex or a tonos is too big for a dot. A character
// whose canonical decomposition carries combining marks (ô = o + ◌̂) has
// them as ink of its own: every piece not touching the letter's body is a
// mark. The body is the tallest piece — accents sit flat above or below the
// letter, however much ink they carry beside a short body (î's circumflex
// over its dotless stem). Marks draw after the body, in the dot tier,
// and stay out of reference matching, so the base letter's reference (o's
// for ô) orders the body alone.

import type { AxisPoint, GeoStroke } from './types.ts';

/** Scripts whose accented letters decompose into a letter plus marks drawn after it. */
const MARK_SCRIPT = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
/** Two strokes touch when their pens come within this many pen widths of each other. */
const TOUCH_WIDTHS = 0.25;

/** Whether `char` is a Latin, Greek or Cyrillic letter that decomposes into a base plus combining marks. */
export function hasCombiningMarks(char: string): boolean {
  return MARK_SCRIPT.test(char) && /\p{M}/u.test(char.normalize('NFD'));
}

/** The letter `char` decomposes to without its combining marks, or null when that isn't one different character. */
export function baseLetter(char: string): string | null {
  const base = char.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return base !== char && [...base].length === 1 ? base : null;
}

/** Gap between the pen at `p` and the ink of a polyline (negative when they overlap). */
function penGap(p: AxisPoint, points: AxisPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[Math.min(i + 1, points.length - 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const radius = (a.width + (b.width - a.width) * u) / 2;
    best = Math.min(best, Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) - radius - p.width / 2);
    if (points.length === 1) break;
  }
  return best;
}

function touch(a: GeoStroke, b: GeoStroke): boolean {
  const reach = (p: AxisPoint) => TOUCH_WIDTHS * Math.max(p.width, 1);
  return a.points.some((p) => penGap(p, b.points) <= reach(p)) || b.points.some((p) => penGap(p, a.points) <= reach(p));
}

/** Per stroke: whether it is a mark — part of a piece of touching strokes other than the body (the tallest piece). */
export function findMarkStrokes(strokes: GeoStroke[]): boolean[] {
  const piece = strokes.map((_, i) => i);
  const find = (i: number): number => (piece[i] === i ? i : (piece[i] = find(piece[i]!)));
  for (let i = 0; i < strokes.length; i++)
    for (let j = i + 1; j < strokes.length; j++) if (find(i) !== find(j) && touch(strokes[i]!, strokes[j]!)) piece[find(i)] = find(j);
  const spans = new Map<number, { top: number; bottom: number }>();
  strokes.forEach((s, i) => {
    const span = spans.get(find(i)) ?? { top: Infinity, bottom: -Infinity };
    for (const p of s.points) {
      span.top = Math.min(span.top, p.y - p.width / 2);
      span.bottom = Math.max(span.bottom, p.y + p.width / 2);
    }
    spans.set(find(i), span);
  });
  if (spans.size < 2) return strokes.map(() => false);
  const [body] = [...spans].reduce((a, b) => (b[1].bottom - b[1].top > a[1].bottom - a[1].top ? b : a));
  return strokes.map((_, i) => find(i) !== body);
}
