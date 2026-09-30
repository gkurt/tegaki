// Minimal SVG path-data parser producing the renderer's PathCommand shape so
// dataset paths run through the same `flattenPath` as font outlines.
//
// Supports the commands KanjiVG emits (M/C/c/S/s and occasional L/l) plus the
// rest of the straight/bezier family for robustness: H/V, Q/T, Z, absolute and
// relative, with implicit command repetition ("c 1,2 3,4 5,6 7,8 9,10 11,12")
// and SVG's rule that coordinate pairs after M/m continue as L/l. Arcs (A/a)
// are not supported — KanjiVG never uses them — and throw rather than silently
// corrupt a stroke.

import type { PathCommand } from 'tegaki/internal';

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WS_RE = /[\s,]*/y;

class Scanner {
  private pos = 0;
  constructor(private readonly d: string) {}

  /** Next command letter, or null at end of input. */
  nextCommand(): string | null {
    this.skipSeparators();
    if (this.pos >= this.d.length) return null;
    const ch = this.d[this.pos]!;
    if (/[a-zA-Z]/.test(ch)) {
      this.pos++;
      return ch;
    }
    return null; // a number: implicit repetition of the previous command
  }

  hasMoreArguments(): boolean {
    this.skipSeparators();
    if (this.pos >= this.d.length) return false;
    return !/[a-zA-Z]/.test(this.d[this.pos]!);
  }

  number(): number {
    this.skipSeparators();
    NUMBER_RE.lastIndex = this.pos;
    const m = NUMBER_RE.exec(this.d);
    if (!m) throw new Error(`Expected number at position ${this.pos} in path data: …${this.d.slice(this.pos, this.pos + 20)}`);
    this.pos = NUMBER_RE.lastIndex;
    return Number(m[0]);
  }

  private skipSeparators(): void {
    WS_RE.lastIndex = this.pos;
    WS_RE.exec(this.d);
    this.pos = WS_RE.lastIndex;
  }
}

/**
 * Parse SVG path data into absolute M/L/C/Q/Z PathCommands. H/V become L;
 * S/T expand to C/Q via control-point reflection.
 */
export function parseSvgPathData(d: string): PathCommand[] {
  const scanner = new Scanner(d);
  const commands: PathCommand[] = [];
  let cx = 0; // cursor
  let cy = 0;
  let sx = 0; // subpath start (for Z)
  let sy = 0;
  // Reflection state: the last cubic/quadratic control point, valid only
  // immediately after a C/S (for S) or Q/T (for T).
  let lastCubicCtrl: { x: number; y: number } | null = null;
  let lastQuadCtrl: { x: number; y: number } | null = null;

  let cmd: string | null = null;
  for (;;) {
    const next = scanner.nextCommand();
    if (next !== null) {
      // Implicit repetition after M/m switches to L/l per the SVG spec.
      cmd = next;
    } else if (cmd === null || !scanner.hasMoreArguments()) {
      break;
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    } else if (cmd.toUpperCase() === 'Z') {
      // Z takes no arguments, so trailing numbers can never belong to it.
      throw new Error('Malformed path data: numbers after Z without a command letter');
    }

    const relative = cmd === cmd.toLowerCase();
    const dx = relative ? cx : 0;
    const dy = relative ? cy : 0;

    switch (cmd.toUpperCase()) {
      case 'M': {
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        sx = cx;
        sy = cy;
        commands.push({ type: 'M', x: cx, y: cy });
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'L': {
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        commands.push({ type: 'L', x: cx, y: cy });
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'H': {
        cx = dx + scanner.number();
        commands.push({ type: 'L', x: cx, y: cy });
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'V': {
        cy = dy + scanner.number();
        commands.push({ type: 'L', x: cx, y: cy });
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'C': {
        const x1 = dx + scanner.number();
        const y1 = dy + scanner.number();
        const x2 = dx + scanner.number();
        const y2 = dy + scanner.number();
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        commands.push({ type: 'C', x1, y1, x2, y2, x: cx, y: cy });
        lastCubicCtrl = { x: x2, y: y2 };
        lastQuadCtrl = null;
        break;
      }
      case 'S': {
        // First control point reflects the previous C/S second control point
        // about the current point; if the previous command wasn't C/S, it
        // coincides with the current point (SVG spec).
        const x1 = lastCubicCtrl ? 2 * cx - lastCubicCtrl.x : cx;
        const y1 = lastCubicCtrl ? 2 * cy - lastCubicCtrl.y : cy;
        const x2 = dx + scanner.number();
        const y2 = dy + scanner.number();
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        commands.push({ type: 'C', x1, y1, x2, y2, x: cx, y: cy });
        lastCubicCtrl = { x: x2, y: y2 };
        lastQuadCtrl = null;
        break;
      }
      case 'Q': {
        const x1 = dx + scanner.number();
        const y1 = dy + scanner.number();
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        commands.push({ type: 'Q', x1, y1, x: cx, y: cy });
        lastQuadCtrl = { x: x1, y: y1 };
        lastCubicCtrl = null;
        break;
      }
      case 'T': {
        // Annotated to break the x1 -> lastQuadCtrl -> x1 inference cycle (TS7022).
        const x1: number = lastQuadCtrl ? 2 * cx - lastQuadCtrl.x : cx;
        const y1: number = lastQuadCtrl ? 2 * cy - lastQuadCtrl.y : cy;
        cx = dx + scanner.number();
        cy = dy + scanner.number();
        commands.push({ type: 'Q', x1, y1, x: cx, y: cy });
        lastQuadCtrl = { x: x1, y: y1 };
        lastCubicCtrl = null;
        break;
      }
      case 'Z': {
        cx = sx;
        cy = sy;
        commands.push({ type: 'Z', x: cx, y: cy });
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      default:
        throw new Error(`Unsupported SVG path command '${cmd}'`);
    }
  }
  return commands;
}
