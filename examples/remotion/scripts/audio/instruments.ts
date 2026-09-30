// The instruments and sound effects, each rendered into a bus at a time.
import { adsr, Biquad, type Bus, hz, rng, SR, saw, sec } from './dsp.ts';

const TAU = Math.PI * 2;

/** A warm pad chord: three detuned saws a note, through a low-pass that opens with `bright`. */
export function pad(bus: Bus, at: number, dur: number, notes: number[], { gain = 0.05, bright = 1200, attack = 0.9, release = 1.6 } = {}) {
  const start = sec(at);
  const len = sec(dur + release);
  notes.forEach((m, ni) => {
    const detunes = [-0.11, 0, 0.12];
    detunes.forEach((cents, vi) => {
      const f = hz(m + cents);
      const dt = f / SR;
      let ph = rng(m * 7 + vi)();
      const lp = new Biquad();
      const lp2 = new Biquad();
      const pan = (vi - 1) * 0.6 + (ni % 2 ? 0.15 : -0.15);
      for (let i = 0; i < len; i++) {
        if (i % 64 === 0) {
          const t = i / SR;
          const wob = 1 + 0.18 * Math.sin(TAU * 0.13 * (at + t) + ni);
          lp.set('lp', bright * wob, 0.6);
          lp2.set('lp', bright * wob * 1.3, 0.5);
        }
        ph += dt;
        if (ph >= 1) ph -= 1;
        const t = i / SR;
        const e = adsr(t, attack, 0.5, 0.85, dur, release);
        bus.add(start + i, lp2.run(lp.run(saw(ph, dt))) * e * gain, pan);
      }
    });
  });
}

/** An FM bell or electric-piano tone. */
export function bell(bus: Bus, at: number, midi: number, { gain = 0.12, decay = 1.6, ratio = 3.5, index = 2.2, pan = 0 } = {}) {
  const start = sec(at);
  const f = hz(midi);
  const len = sec(decay * 3);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / decay) * Math.min(1, t / 0.004);
    const mod = Math.sin(TAU * f * ratio * t) * index * Math.exp(-t / (decay * 0.35));
    const v = Math.sin(TAU * f * t + mod) * 0.8 + Math.sin(TAU * f * 2 * t) * 0.12 * Math.exp(-t / 0.3);
    bus.add(start + i, v * env * gain, pan);
  }
}

/** A plucked saw with a filter envelope: the arpeggio. */
export function pluck(bus: Bus, at: number, midi: number, { gain = 0.07, decay = 0.28, cutoff = 3200, pan = 0 } = {}) {
  const start = sec(at);
  const f = hz(midi);
  const dt = f / SR;
  let ph = 0;
  const lp = new Biquad();
  const len = sec(decay * 4);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (i % 32 === 0) lp.set('lp', 300 + cutoff * Math.exp(-t / (decay * 0.5)), 1.1);
    ph += dt;
    if (ph >= 1) ph -= 1;
    const env = Math.exp(-t / decay) * Math.min(1, t / 0.002);
    bus.add(start + i, lp.run(saw(ph, dt) * 0.7 + Math.sin(TAU * ph) * 0.3) * env * gain, pan);
  }
}

/** A round sub bass note. */
export function bass(bus: Bus, at: number, dur: number, midi: number, { gain = 0.2 } = {}) {
  const start = sec(at);
  const f = hz(midi);
  const dt = f / SR;
  let ph = 0;
  const lp = new Biquad().set('lp', 380, 0.8);
  const len = sec(dur + 0.08);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    const env = Math.min(1, t / 0.008) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1);
    const v = Math.sin(TAU * ph) * 0.85 + lp.run(saw(ph, dt)) * 0.3;
    bus.add(start + i, Math.tanh(v * 1.4) * env * gain);
  }
}

/** A kick drum. Returns nothing; `duck` collects where it hits, for the sidechain. */
export function kick(bus: Bus, at: number, { gain = 0.5, tone = 1 } = {}) {
  const start = sec(at);
  const len = sec(0.45);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 45 + 110 * Math.exp(-t / 0.035) * tone;
    ph += f / SR;
    const env = Math.exp(-t / 0.16) * Math.min(1, t / 0.001);
    const click = Math.exp(-t / 0.003) * 0.35;
    bus.add(start + i, (Math.sin(TAU * ph) * env + click * Math.sin(TAU * 1800 * t)) * gain);
  }
}

/** Filtered noise with an envelope: hats, shakers, claps, whooshes build on it. */
function noiseHit(
  bus: Bus,
  at: number,
  dur: number,
  seed: number,
  shape: (t: number) => number,
  filter: (t: number) => { type: 'lp' | 'hp' | 'bp'; f: number; q?: number },
  gain: number,
  pan: number | ((t: number) => number) = 0,
) {
  const start = sec(at);
  const len = sec(dur);
  const r = rng(seed);
  const bq = new Biquad();
  const bq2 = new Biquad();
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (i % 32 === 0) {
      const o = filter(t);
      bq.set(o.type, o.f, o.q ?? Math.SQRT1_2);
      bq2.set(o.type, o.f, o.q ?? Math.SQRT1_2);
    }
    const v = bq2.run(bq.run(r() * 2 - 1)) * shape(t) * gain;
    bus.add(start + i, v, typeof pan === 'function' ? pan(t) : pan);
  }
}

export function hat(bus: Bus, at: number, { gain = 0.06, open = false, pan = 0.2, seed = 1 } = {}) {
  const d = open ? 0.18 : 0.035;
  noiseHit(
    bus,
    at,
    d * 4,
    seed,
    (t) => Math.exp(-t / d),
    () => ({ type: 'hp', f: 7500 }),
    gain,
    pan,
  );
}

export function shaker(bus: Bus, at: number, { gain = 0.03, seed = 2, pan = -0.3 } = {}) {
  noiseHit(
    bus,
    at,
    0.12,
    seed,
    (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.03),
    () => ({ type: 'bp', f: 6500, q: 1.2 }),
    gain,
    pan,
  );
}

export function clap(bus: Bus, at: number, { gain = 0.16, seed = 3 } = {}) {
  noiseHit(
    bus,
    at,
    0.4,
    seed,
    (t) => {
      const bursts = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) / 0.006) : 0), 0);
      return bursts * 0.6 + (t > 0.022 ? Math.exp(-(t - 0.022) / 0.12) : 0);
    },
    () => ({ type: 'bp', f: 1300, q: 0.9 }),
    gain,
  );
}

/** Air rushing past: band-passed noise sweeping up (or down), panning across. */
export function whoosh(
  bus: Bus,
  at: number,
  dur: number,
  { gain = 0.18, from = 400, to = 4000, seed = 4, panFrom = -0.6, panTo = 0.6 } = {},
) {
  noiseHit(
    bus,
    at,
    dur,
    seed,
    (t) => Math.sin(Math.PI * Math.min(1, t / dur)) ** 1.6,
    (t) => ({ type: 'bp', f: from * (to / from) ** (t / dur), q: 1.4 }),
    gain,
    (t) => panFrom + (panTo - panFrom) * (t / dur),
  );
}

/** A riser: noise and a sine climbing over `dur`, cut dead at the end. */
export function riser(bus: Bus, at: number, dur: number, { gain = 0.12, seed = 5 } = {}) {
  noiseHit(
    bus,
    at,
    dur,
    seed,
    (t) => (t / dur) ** 2.2,
    (t) => ({ type: 'bp', f: 300 * 30 ** (t / dur), q: 2 }),
    gain,
  );
  const start = sec(at);
  const len = sec(dur);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (180 * 6 ** (t / dur)) / SR;
    bus.add(start + i, Math.sin(TAU * ph) * (t / dur) ** 3 * gain * 0.35);
  }
}

/** A cinematic hit: a sub drop, a noise burst and a low tone. */
export function impact(bus: Bus, at: number, { gain = 0.4, seed = 6 } = {}) {
  const start = sec(at);
  const len = sec(2.2);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (38 + 70 * Math.exp(-t / 0.08)) / SR;
    bus.add(start + i, Math.sin(TAU * ph) * Math.exp(-t / 0.7) * gain);
  }
  noiseHit(
    bus,
    at,
    1.2,
    seed,
    (t) => Math.exp(-t / 0.18),
    (t) => ({ type: 'lp', f: 5000 * Math.exp(-t / 0.3) + 200 }),
    gain * 0.5,
  );
}

/** A UI click: a short tick with a tone under it. */
export function click(bus: Bus, at: number, { gain = 0.12, tone = 2200, pan = 0 } = {}) {
  const start = sec(at);
  const len = sec(0.05);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    bus.add(
      start + i,
      (Math.sin(TAU * tone * t) * Math.exp(-t / 0.006) + Math.sin(TAU * tone * 0.5 * t) * Math.exp(-t / 0.012) * 0.5) * gain,
      pan,
    );
  }
  noiseHit(
    bus,
    at,
    0.02,
    Math.round(at * 1000),
    (t) => Math.exp(-t / 0.002),
    () => ({ type: 'hp', f: 3000 }),
    gain * 0.6,
    pan,
  );
}

/** A soft paper tap: a card landing. */
export function tap(bus: Bus, at: number, { gain = 0.1, pan = 0, seed = 7 } = {}) {
  noiseHit(
    bus,
    at,
    0.12,
    seed,
    (t) => Math.exp(-t / 0.018),
    () => ({ type: 'bp', f: 900, q: 0.8 }),
    gain,
    pan,
  );
}

/** A key press: a clack with a little pitch to it. */
export function key(bus: Bus, at: number, { gain = 0.08, seed = 8, pan = 0 } = {}) {
  const r = rng(seed);
  noiseHit(
    bus,
    at,
    0.06,
    seed,
    (t) => Math.exp(-t / 0.008),
    () => ({ type: 'bp', f: 2200 + r() * 1400, q: 2.5 }),
    gain,
    pan,
  );
  noiseHit(
    bus,
    at + 0.012,
    0.05,
    seed + 1,
    (t) => Math.exp(-t / 0.01),
    () => ({ type: 'bp', f: 700, q: 1.5 }),
    gain * 0.5,
    pan,
  );
}

/** Glitter: a spray of tiny high sine grains over `dur`. */
export function sparkle(bus: Bus, at: number, dur: number, { gain = 0.03, density = 40, seed = 9, pan = 0 } = {}) {
  const r = rng(seed);
  const n = Math.round(dur * density);
  for (let k = 0; k < n; k++) {
    const t0 = at + r() * dur;
    const f = 3000 + r() ** 2 * 6000;
    const d = 0.03 + r() * 0.08;
    const p = pan + (r() - 0.5) * 1.2;
    const g = gain * (0.4 + r() * 0.6);
    const s = sec(t0);
    const len = sec(d * 4);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      bus.add(s + i, Math.sin(TAU * f * t) * Math.exp(-t / d) * Math.min(1, t / 0.002) * g, p);
    }
  }
}

/** The buzz of a neon tube, flickering. */
export function neonHum(bus: Bus, at: number, dur: number, { gain = 0.04, seed = 10 } = {}) {
  const r = rng(seed);
  const start = sec(at);
  const len = sec(dur);
  const lp = new Biquad().set('lp', 1800, 0.7);
  let flick = 1;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (i % 1600 === 0) flick = r() < 0.12 ? 0.2 : 0.85 + r() * 0.15;
    const buzz = Math.sign(Math.sin(TAU * 120 * t)) * 0.3 + Math.sin(TAU * 240 * t) * 0.3 + Math.sin(TAU * 360 * t) * 0.15;
    const env = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.4);
    bus.add(start + i, lp.run(buzz) * flick * env * gain, -0.2);
  }
}

/** Fire: low rumble with crackles. */
export function crackle(bus: Bus, at: number, dur: number, { gain = 0.06, seed = 11, pan = 0.3 } = {}) {
  const r = rng(seed);
  const n = Math.round(dur * 26);
  for (let k = 0; k < n; k++) {
    const t0 = at + r() * dur;
    noiseHit(
      bus,
      t0,
      0.02,
      seed + k,
      (t) => Math.exp(-t / 0.003),
      () => ({ type: 'bp', f: 1500 + r() * 3000, q: 1.5 }),
      gain * (0.5 + r()),
      pan + (r() - 0.5) * 0.4,
    );
  }
  noiseHit(
    bus,
    at,
    dur,
    seed + 999,
    (t) => Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.5),
    () => ({ type: 'lp', f: 400 }),
    gain * 1.5,
    pan,
  );
}

/** A glitchy burst: bit-crushed square blips. */
export function blips(bus: Bus, at: number, dur: number, { gain = 0.035, seed = 12, pan = -0.3 } = {}) {
  const r = rng(seed);
  const n = Math.round(dur * 12);
  for (let k = 0; k < n; k++) {
    const t0 = at + r() * dur;
    const f = [880, 1320, 1760, 660][Math.floor(r() * 4)]!;
    const d = 0.02 + r() * 0.05;
    const s = sec(t0);
    const len = sec(d);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const v = Math.sign(Math.sin((TAU * f * Math.floor(t * 8000)) / 8000));
      bus.add(s + i, v * gain * (1 - t / d), pan);
    }
  }
}
