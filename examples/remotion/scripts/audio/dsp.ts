// A small offline synth: buffers, oscillators, filters, envelopes and a
// reverb, enough to score the launch video without samples. Everything is
// seeded, so the same script writes the same file every time.

export const SR = 48000;

/** A stereo buffer. */
export class Bus {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(readonly length: number) {
    this.l = new Float32Array(length);
    this.r = new Float32Array(length);
  }
  /** Add a sample at `i`, panned (-1 left … 1 right, equal power). */
  add(i: number, v: number, pan = 0) {
    if (i < 0 || i >= this.length) return;
    const a = ((pan + 1) * Math.PI) / 4;
    this.l[i]! += v * Math.cos(a);
    this.r[i]! += v * Math.sin(a);
  }
  addLR(i: number, l: number, r: number) {
    if (i < 0 || i >= this.length) return;
    this.l[i]! += l;
    this.r[i]! += r;
  }
  mixInto(into: Bus, gain = 1, gainAt?: (i: number) => number) {
    for (let i = 0; i < this.length; i++) {
      const g = gainAt ? gain * gainAt(i) : gain;
      into.l[i]! += this.l[i]! * g;
      into.r[i]! += this.r[i]! * g;
    }
  }
}

export const sec = (s: number) => Math.round(s * SR);
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** mulberry32: a seeded generator, 0–1. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A band-limited saw (polyBLEP). */
export function saw(phase: number, dt: number): number {
  let v = 2 * phase - 1;
  if (phase < dt) {
    const t = phase / dt;
    v -= t + t - t * t - 1;
  } else if (phase > 1 - dt) {
    const t = (phase - 1) / dt;
    v -= t * t + t + t + 1;
  }
  return v;
}

/** An RBJ biquad; set it per block for sweeps. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  set(type: 'lp' | 'hp' | 'bp', f: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Attack, then exponential decay with a hold: `env(t)` for t seconds after the start. */
export function adsr(t: number, a: number, d: number, s: number, hold: number, r: number): number {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < hold) return s;
  const k = t - Math.max(hold, a + d);
  return k > r ? 0 : s * (1 - k / r) ** 2;
}

// --- Freeverb -------------------------------------------------------------

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(
    size: number,
    private feedback: number,
    private damp: number,
  ) {
    this.buf = new Float32Array(size);
  }
  run(x: number) {
    const y = this.buf[this.i]!;
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.feedback;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  run(x: number) {
    const b = this.buf[this.i]!;
    this.buf[this.i] = x + b * 0.5;
    this.i = (this.i + 1) % this.buf.length;
    return b - x;
  }
}

/** A hall: the bus run through Freeverb's combs and allpasses, returned wet. */
export function reverb(input: Bus, { room = 0.86, damp = 0.35, predelay = 0.02 } = {}): Bus {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const spread = 23;
  const out = new Bus(input.length);
  const cl = combs.map((c) => new Comb(Math.round(c * k), room, damp));
  const cr = combs.map((c) => new Comb(Math.round((c + spread) * k), room, damp));
  const al = aps.map((a) => new Allpass(Math.round(a * k)));
  const ar = aps.map((a) => new Allpass(Math.round((a + spread) * k)));
  const pd = sec(predelay);
  for (let i = 0; i < input.length; i++) {
    const j = i - pd;
    const x = j >= 0 ? (input.l[j]! + input.r[j]!) * 0.015 : 0;
    let l = 0;
    let r = 0;
    for (const c of cl) l += c.run(x);
    for (const c of cr) r += c.run(x);
    for (const a of al) l = a.run(l);
    for (const a of ar) r = a.run(r);
    out.l[i] = l;
    out.r[i] = r;
  }
  return out;
}

/** A stereo ping-pong echo, returned wet. */
export function pingPong(input: Bus, delay: number, feedback: number, lp = 3500): Bus {
  const d = sec(delay);
  const out = new Bus(input.length);
  const fl = new Biquad().set('lp', lp);
  const fr = new Biquad().set('lp', lp);
  for (let i = 0; i < input.length; i++) {
    const pl = i >= d ? out.r[i - d]! : 0;
    const pr = i >= d ? out.l[i - d]! : 0;
    out.l[i] = fl.run((input.l[i]! + input.r[i]!) * 0.5 + pl * feedback);
    out.r[i] = fr.run(pr * feedback);
  }
  return out;
}

/** 16-bit PCM WAV of a stereo bus. */
export function wav(bus: Bus): Uint8Array {
  const n = bus.length;
  const data = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, SR, true);
  data.setUint32(28, SR * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    data.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, bus.l[i]!)) * 32767), true);
    data.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, bus.r[i]!)) * 32767), true);
  }
  return new Uint8Array(data.buffer);
}
