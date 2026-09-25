import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { foldExtras, regroupStrokesByReference } from './regroup.ts';
import type { AxisPoint, GeoStroke } from './types.ts';

const pts = (coords: [number, number][], width = 40): AxisPoint[] => coords.map(([x, y]) => ({ x, y, width }));
const stroke = (points: AxisPoint[], isLoop = false): GeoStroke => ({ points, isLoop, segmentIndices: [0] });
const ref = (coords: [number, number][]): Point[] => coords.map(([x, y]) => ({ x, y }));

const OPTIONS = { spacing: 20, minRunLength: 60, glyphDiag: 800, maxMeanCost: 0.15 };

const xs = (s: GeoStroke) => s.points.map((p) => p.x);
const ys = (s: GeoStroke) => s.points.map((p) => p.y);
const spanX = (s: GeoStroke) => Math.max(...xs(s)) - Math.min(...xs(s));
const spanY = (s: GeoStroke) => Math.max(...ys(s)) - Math.min(...ys(s));

describe('regroupStrokesByReference — splitting', () => {
  test('a closed box loop splits into the three prescribed strokes (口)', () => {
    // Square ring centerline drawn as one closed loop.
    const loop = stroke(
      pts([
        [100, 100],
        [500, 100],
        [500, 500],
        [100, 500],
        [100, 100],
      ]),
      true,
    );
    // Prescription: left vertical, top+right bent stroke, bottom bar.
    const refs = [
      ref([
        [100, 100],
        [100, 500],
      ]),
      ref([
        [100, 100],
        [500, 100],
        [500, 500],
      ]),
      ref([
        [100, 500],
        [500, 500],
      ]),
    ];
    const result = regroupStrokesByReference([loop], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.splits).toBe(1);
    expect(result!.strokes.length).toBe(3);
    // One part hugs the left side, one covers top+right (both spans large),
    // one hugs the bottom.
    const left = result!.strokes.find((s) => xs(s).every((x) => x < 120))!;
    expect(left).toBeDefined();
    expect(spanY(left)).toBeGreaterThan(300);
    const bent = result!.strokes.find((s) => spanX(s) > 300 && spanY(s) > 300)!;
    expect(bent).toBeDefined();
    const bottom = result!.strokes.find((s) => ys(s).every((y) => y > 480))!;
    expect(bottom).toBeDefined();
    for (const s of result!.strokes) expect(s.isLoop).toBe(false);
  });

  test('crossing another reference does not split the stroke (direction penalty)', () => {
    // Vertical stroke slightly off its own reference; a horizontal reference
    // crosses it at y=350 and is momentarily CLOSER there — but the travel
    // direction never aligns with it, so the label must not flicker.
    const vertical = stroke(
      pts([
        [310, 100],
        [310, 600],
      ]),
    );
    const refs = [
      ref([
        [300, 100],
        [300, 600],
      ]),
      ref([
        [100, 350],
        [500, 350],
      ]),
    ];
    expect(regroupStrokesByReference([vertical], refs, OPTIONS)).toBeNull();
  });

  test('a single stroke matching a single reference is unchanged (null)', () => {
    const bar = stroke(
      pts([
        [200, 100],
        [200, 600],
      ]),
    );
    const refs = [
      ref([
        [200, 100],
        [200, 600],
      ]),
    ];
    expect(regroupStrokesByReference([bar], refs, OPTIONS)).toBeNull();
  });
});

describe('regroupStrokesByReference — merging', () => {
  test('two pieces along one reference chain end-to-end in reference order', () => {
    // Piece B is supplied REVERSED (bottom-up); orientation comes from the
    // reference's arc-length direction, not from the input order.
    const a = stroke(
      pts(
        [
          [100, 100],
          [100, 300],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [100, 600],
          [100, 340],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [100, 600],
      ]),
    ];
    const result = regroupStrokesByReference([b, a], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // Travels top → bottom following the reference.
    expect(merged.points[0]!.y).toBe(100);
    expect(merged.points[merged.points.length - 1]!.y).toBe(600);
  });

  test('pieces with a large gap along the reference stay separate', () => {
    const a = stroke(
      pts(
        [
          [100, 100],
          [100, 250],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [100, 700],
          [100, 900],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [100, 900],
      ]),
    ];
    // Gap of 450 exceeds both 2×width and 5% of the diagonal — no merge.
    expect(regroupStrokesByReference([a, b], refs, OPTIONS)).toBeNull();
  });

  test('retrace within the NEXT piece: enter its interior, walk to its head, then forward (れ corridor)', () => {
    // Reference travels right, down a corridor, back UP the same corridor,
    // then right again — the font fuses the double-travel into one diagonal,
    // so the extracted continuation piece B starts at the corridor's FAR end
    // while piece A's tail touches B's interior.
    const a = stroke(
      pts(
        [
          [0, 0],
          [95, 0],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [100, 200],
          [100, 5],
          [300, 5],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [0, 0],
        [100, 0],
        [100, 200],
        [100, 0],
        [300, 0],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.retraces).toBe(1);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // Path: entry → down the corridor to its bottom → back up → out right.
    expect(merged.points[0]!.x).toBe(0);
    expect(Math.max(...ys(merged))).toBe(200);
    const bottomIdx = merged.points.findIndex((p) => p.y === 200);
    expect(bottomIdx).toBeGreaterThan(0);
    expect(bottomIdx).toBeLessThan(merged.points.length - 1);
    expect(merged.points[merged.points.length - 1]!.x).toBe(300);
  });

  test('retrace within the CURRENT piece: walk back from its tail to where the next head touches', () => {
    // Piece A ends deep in the corridor; piece B continues from the
    // corridor's MOUTH — the pen must back out of A along A's own ink.
    const a = stroke(
      pts(
        [
          [0, 0],
          [100, 0],
          [100, 200],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [105, 5],
          [300, 5],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [0, 0],
        [100, 0],
        [100, 200],
        [100, 0],
        [300, 0],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.retraces).toBe(1);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // Reaches the corridor bottom mid-path, then returns and exits right.
    const bottomIdx = merged.points.findIndex((p) => p.y === 200);
    expect(bottomIdx).toBeGreaterThan(0);
    expect(bottomIdx).toBeLessThan(merged.points.length - 1);
    expect(merged.points[merged.points.length - 1]!.x).toBe(300);
  });

  test('double-sided retrace: a stranded spur backs out to meet the next piece mid-corridor (わ crossing)', () => {
    // Piece A ends on a short spur away from the corridor; piece B starts at
    // the corridor's far end. Neither endpoint reaches the other piece, but
    // the two INTERIORS meet near the corridor mouth — the pen must back out
    // of the spur, then enter the corridor and traverse it both ways.
    const a = stroke(
      pts(
        [
          [0, 0],
          [95, 0],
          [110, -60],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [100, 200],
          [100, 5],
          [300, 5],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [0, 0],
        [100, 0],
        [100, 200],
        [100, 0],
        [300, 0],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.retraces).toBe(1);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // The spur is drawn out and back...
    const spurIdx = merged.points.findIndex((p) => p.y === -60);
    expect(spurIdx).toBeGreaterThan(0);
    expect(merged.points[spurIdx + 1]!.y).toBeGreaterThan(-60);
    // ...then the corridor bottom is reached mid-path and the stroke exits right.
    const bottomIdx = merged.points.findIndex((p) => p.y === 200);
    expect(bottomIdx).toBeGreaterThan(spurIdx);
    expect(bottomIdx).toBeLessThan(merged.points.length - 1);
    expect(merged.points[merged.points.length - 1]!.x).toBe(300);
  });

  test('via join: the connection rides a THIRD piece assigned to another reference (わ corridor)', () => {
    // The prescribed second stroke runs down the stem corridor between its
    // entry and its bottom sweep — ink the matcher assigns to the STEM
    // reference. The chain must hop onto the stem piece, walk it down, and
    // exit into the sweep.
    const entry = stroke(
      pts(
        [
          [0, 0],
          [95, 0],
        ],
        30,
      ),
    );
    const stem = stroke(
      pts(
        [
          [100, 10],
          [100, 300],
        ],
        30,
      ),
    );
    const sweep = stroke(
      pts(
        [
          [110, 305],
          [300, 305],
        ],
        30,
      ),
    );
    const refs = [
      // Stem reference.
      ref([
        [100, 0],
        [100, 300],
      ]),
      // Second stroke: enters, rides the stem down, sweeps right.
      ref([
        [0, 0],
        [100, 0],
        [100, 300],
        [300, 300],
      ]),
    ];
    const result = regroupStrokesByReference([entry, stem, sweep], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.strokes.length).toBe(2);
    expect(result!.retraces).toBe(1);
    // The merged second stroke travels down the corridor to y≈300 mid-path.
    const merged = result!.strokes.find((s) => s.points[0]!.x === 0)!;
    expect(merged).toBeDefined();
    const bottomIdx = merged.points.findIndex((p) => p.y === 300);
    expect(bottomIdx).toBeGreaterThan(0);
    expect(merged.points[merged.points.length - 1]!.x).toBe(300);
    // The stem itself stays a separate stroke.
    expect(result!.strokes.some((s) => s.points.length === 2 && s.points[0]!.y === 10)).toBe(true);
  });

  test('stub absorption: a spur touching a longer piece MID-path splices in as an out-and-back excursion (そ/ん self-overlap)', () => {
    // The reference travels out to a tip and back over the same corridor
    // mid-stroke; the font fuses the doubled travel, so the skeleton keeps
    // one through-path plus a spur holding the stroke's real tip. The pen
    // must visit the tip mid-path — no tail-append join can produce that.
    const host = stroke(
      pts(
        [
          [0, 0],
          [500, 0],
        ],
        30,
      ),
    );
    const spur = stroke(
      pts(
        [
          [250, 10],
          [250, 120],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [0, 0],
        [250, 0],
        [250, 120],
        [250, 0],
        [500, 0],
      ]),
    ];
    const result = regroupStrokesByReference([host, spur], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.retraces).toBe(1);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // Starts at the host's head, dips to the tip mid-path, ends at the host's tail.
    expect(merged.points[0]!.x).toBe(0);
    const tipIdx = merged.points.findIndex((p) => p.y === 120);
    expect(tipIdx).toBeGreaterThan(0);
    expect(tipIdx).toBeLessThan(merged.points.length - 1);
    expect(merged.points[merged.points.length - 1]!.x).toBe(500);
  });

  test('a stub touching near the host END chains plainly instead of splicing an excursion', () => {
    const host = stroke(
      pts(
        [
          [0, 0],
          [500, 0],
        ],
        30,
      ),
    );
    const tail = stroke(
      pts(
        [
          [510, 0],
          [620, 0],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [0, 0],
        [620, 0],
      ]),
    ];
    const result = regroupStrokesByReference([host, tail], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.merges).toBe(1);
    expect(result!.retraces).toBe(0);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    expect(merged.points[merged.points.length - 1]!.x).toBe(620);
  });

  test('overlap dedup: ink re-traveling an already-covered corridor is dropped, not chained (ね/ゅ wandering)', () => {
    // Piece B duplicates the middle of piece A's corridor inside A's pen —
    // the skeleton of a wandering fat region. Chaining would re-draw the
    // middle; the dedup piece set drops B and wins the re-match with A's
    // single clean travel.
    const a = stroke(
      pts(
        [
          [100, 100],
          [100, 600],
        ],
        60,
      ),
    );
    const b = stroke(
      pts(
        [
          [115, 250],
          [115, 450],
        ],
        20,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [100, 600],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.pruned).toBeGreaterThan(0);
    expect(result!.strokes.length).toBe(1);
    const merged = result!.strokes[0]!;
    // Single travel: no doubled middle, so the length stays near the corridor's.
    let len = 0;
    for (let i = 1; i < merged.points.length; i++) {
      len += Math.hypot(merged.points[i]!.x - merged.points[i - 1]!.x, merged.points[i]!.y - merged.points[i - 1]!.y);
    }
    expect(len).toBeLessThan(600);
    // A continuation piece is NOT a duplicate: covering new reference arc
    // survives dedup — pinned by the plain-merge tests above, which still
    // chain end-to-end pieces instead of dropping them.
  });

  test('coverage veto: a parallel piece whose ink the kept pen does not reach is never pruned (Playfair Display 9)', () => {
    // B runs alongside A a width away, but A's 30-unit pen paints only the
    // near third of B's: dropping B would leave a 20-unit band bare.
    const a = stroke(
      pts(
        [
          [100, 100],
          [100, 600],
        ],
        30,
      ),
    );
    const b = stroke(
      pts(
        [
          [120, 250],
          [120, 450],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [100, 600],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result?.pruned ?? 0).toBe(0);
  });

  test('coverage veto: crossing ink the reference lacks is never pruned as duplicate (crossbar 7)', () => {
    // A fat stem plus a perpendicular crossbar, against a reference that has
    // no crossbar. Everything the crossbar covers projects onto reference
    // arcs the stem already claimed, and (being wide) its edges sit within
    // an ink width of its own kept fragments — the dedup heuristic reads it
    // as duplicated travel. But no kept ink runs ALONGSIDE it: pruning it
    // would lose real coverage, so the veto must reinstate every drop.
    const stem = stroke(
      pts(
        [
          [400, 100],
          [400, 400],
          [400, 700],
        ],
        70,
      ),
    );
    const crossbar = stroke(
      pts(
        [
          [250, 400],
          [400, 400],
          [550, 400],
        ],
        70,
      ),
    );
    const refs = [
      ref([
        [400, 100],
        [400, 700],
      ]),
    ];
    const result = regroupStrokesByReference([stem, crossbar], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.pruned).toBe(0);
    // Both crossbar tips survive in the proposal — the ink is re-organized,
    // never deleted.
    const all = result!.strokes.flatMap((s) => s.points);
    expect(Math.min(...all.map((p) => p.x))).toBeLessThanOrEqual(260);
    expect(Math.max(...all.map((p) => p.x))).toBeGreaterThanOrEqual(540);
    // And better: the crossbar is a stroke of its own, appended after the
    // reference-matched stem — not spliced into it as an excursion.
    expect(result!.extras).toBe(1);
    const extra = result!.strokes[result!.strokes.length - 1]!;
    expect(spanX(extra)).toBeGreaterThanOrEqual(290);
    expect(spanY(extra)).toBeLessThanOrEqual(10);
  });

  test('empty-reference fill: a reference stroke landing off-ink still claims its nearest spare piece (星/歌/歩 proportion drift)', () => {
    // The dataset draws the component wider than the font, so ref 0 (a
    // vertical) maps ~150 units left of its real ink — the vertical piece
    // labels the horizontal reference it approaches, leaving ref 0 with NO
    // pieces and the proposal one stroke short.
    const vertical = stroke(
      pts(
        [
          [250, 480],
          [250, 400],
        ],
        30,
      ),
    );
    const horizontal = stroke(
      pts(
        [
          [200, 500],
          [600, 500],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [100, 380],
        [100, 500],
      ]),
      ref([
        [200, 500],
        [600, 500],
      ]),
    ];
    const result = regroupStrokesByReference([vertical, horizontal], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.strokes.length).toBe(2);
    expect(result!.strokes.some((s) => s.points.every((p) => p.x === 250))).toBe(true);
    expect(result!.strokes.some((s) => s.points.every((p) => p.y === 500))).toBe(true);
  });

  test('orphan rescue: a chain strand unreachable in its own group attaches to the chain its ink touches (む/船)', () => {
    // Piece C labels the horizontal reference (it IS bar ink) but cannot
    // chain to the bar's other piece across the gap; its end touches the
    // vertical stroke's head, so the pen picks it up there.
    const a = stroke(
      pts(
        [
          [100, 100],
          [100, 500],
        ],
        10,
      ),
    );
    const b = stroke(
      pts(
        [
          [300, 100],
          [500, 100],
        ],
        10,
      ),
    );
    const c = stroke(
      pts(
        [
          [100, 95],
          [180, 95],
        ],
        10,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [500, 100],
      ]),
      ref([
        [100, 100],
        [100, 500],
      ]),
    ];
    const result = regroupStrokesByReference([a, b, c], refs, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.strokes.length).toBe(2);
    // C's ink rides with the vertical, not as a third stroke.
    const rescued = result!.strokes.find((s) => s.points.some((p) => p.y === 500))!;
    expect(rescued).toBeDefined();
    expect(rescued.points.some((p) => p.x === 180)).toBe(true);
  });

  test('rejected proposals leave the input strokes untouched', () => {
    const a = stroke(
      pts(
        [
          [100, 600],
          [100, 340],
        ],
        30,
      ),
    );
    const before = a.points.map((p) => ({ ...p }));
    const b = stroke(
      pts(
        [
          [100, 100],
          [100, 300],
        ],
        30,
      ),
    );
    const refs = [
      ref([
        [100, 100],
        [100, 600],
      ]),
    ];
    const result = regroupStrokesByReference([a, b], refs, OPTIONS);
    expect(result).not.toBeNull();
    // The caller may reject `result`; the originals must not have been
    // reversed or concatenated in place.
    expect(a.points).toEqual(before);
    expect(b.points.length).toBe(2);
  });
});

describe('foldExtras — lifted extras that belong to a chain', () => {
  // A 横 (and a 撇 below it) chained from the reference; widths 40, so the
  // join reach is max(2 × 40, 5% of 800) = 80.
  const bar = () =>
    stroke(
      pts([
        [100, 400],
        [300, 400],
        [500, 400],
      ]),
    );
  const barRef = ref([
    [100, 400],
    [500, 400],
  ]);

  test('an extra running on from a chain end, in its direction, extends the chain (a 横 past the 撇)', () => {
    const tail = stroke(
      pts([
        [500, 400],
        [560, 402],
        [620, 404],
      ]),
    );
    const result = foldExtras([bar()], [tail], [barRef], OPTIONS);
    expect(result.extras.length).toBe(0);
    expect(result.folded).toBe(1);
    expect(xs(result.chains[0]!)).toEqual([100, 300, 500, 560, 620]);
  });

  test('an extra is oriented to leave the joint, whichever way it was traced', () => {
    const tail = stroke(
      pts([
        [620, 404],
        [560, 402],
        [500, 400],
      ]),
    );
    const result = foldExtras([bar()], [tail], [barRef], OPTIONS);
    expect(xs(result.chains[0]!)).toEqual([100, 300, 500, 560, 620]);
  });

  test('a chain starting with a jog through a junction is trimmed back to where the extra lands (撇 starting above the 横)', () => {
    // The 撇 chain steps sideways along the 横 before heading down-left; its
    // top above the 横 was lifted. The top continues the 撇 from the jog's
    // corner, not from the chain's head.
    const pie = stroke(
      pts([
        [340, 400],
        [300, 400],
        [100, 700],
      ]),
    );
    const top = stroke(
      pts([
        [300, 400],
        [360, 310],
      ]),
    );
    const pieRef = ref([
      [360, 310],
      [100, 700],
    ]);
    const result = foldExtras([pie], [top], [pieRef], OPTIONS);
    expect(result.extras.length).toBe(0);
    expect(result.chains[0]!.points.map((p) => [p.x, p.y])).toEqual([
      [360, 310],
      [300, 400],
      [100, 700],
    ]);
    expect(result.dropped).toBeCloseTo(40);
  });

  test('an extra whose ends sit on a short chain section replaces it (the curl where a 横折 begins)', () => {
    const chain = stroke(
      pts([
        [100, 400],
        [200, 400],
        [260, 400],
        [500, 400],
      ]),
    );
    const curl = stroke(
      pts([
        [260, 400],
        [230, 330],
        [200, 400],
      ]),
    );
    const result = foldExtras([chain], [curl], [barRef], OPTIONS);
    expect(result.extras.length).toBe(0);
    expect(result.chains[0]!.points.map((p) => [p.x, p.y])).toEqual([
      [100, 400],
      [200, 400],
      [230, 330],
      [260, 400],
      [500, 400],
    ]);
  });

  test('an extra lying along a chain is dropped as already painted', () => {
    const overlap = stroke(
      pts([
        [200, 410],
        [350, 410],
      ]),
    );
    const result = foldExtras([bar()], [overlap], [barRef], OPTIONS);
    expect(result.extras.length).toBe(0);
    expect(result.folded).toBe(0);
    expect(result.dropped).toBeCloseTo(150);
  });

  test("a link whose two ends sit inside other strokes is not dropped: its middle is ink no one else paints (Caveat P's stem-to-bowl join)", () => {
    const stem = stroke(
      pts([
        [100, 700],
        [100, 400],
      ]),
    );
    const bowl = stroke(
      pts([
        [180, 400],
        [400, 300],
        [180, 250],
      ]),
    );
    const link = stroke(
      pts([
        [100, 400],
        [180, 400],
      ]),
    );
    const refs = [
      ref([
        [100, 700],
        [100, 400],
      ]),
      ref([
        [180, 400],
        [400, 300],
        [180, 250],
      ]),
    ];
    const result = foldExtras([stem, bowl], [link], refs, OPTIONS);
    expect(result.dropped).toBe(0);
    // Some stroke still draws the segment between the stem top and the bowl start.
    const spans = [...result.chains, ...result.extras].flatMap((s) => s.points.slice(1).map((p, i) => [s.points[i]!, p] as const));
    expect(spans.some(([a, b]) => a.y === 400 && b.y === 400 && Math.min(a.x, b.x) === 100 && Math.max(a.x, b.x) === 180)).toBe(true);
  });

  test('a bar crossing a stem mid-way, free at both ends, stays an extra (crossed 7)', () => {
    const stem = stroke(
      pts([
        [400, 100],
        [400, 700],
      ]),
    );
    const crossbar = stroke(
      pts([
        [250, 400],
        [550, 400],
      ]),
    );
    const result = foldExtras(
      [stem],
      [crossbar],
      [
        ref([
          [400, 100],
          [400, 700],
        ]),
      ],
      OPTIONS,
    );
    expect(result.extras.length).toBe(1);
    expect(result.folded + result.dropped).toBe(0);
  });
});
