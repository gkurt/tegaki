/**
 * Shared low-level helpers for the built-in audio drivers. Kept private to the
 * `tegaki/audio` entry point — drivers built outside the package should
 * reimplement what they need rather than reach in here.
 */

/**
 * Build a looping noise BufferSource. Reusing a buffer across multiple sources
 * is fine and keeps the per-driver memory footprint to a single short clip.
 */
export function createNoiseBuffer(ctx: AudioContext, durationSec = 1, kind: 'white' | 'pink' = 'white'): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
  // Paul Kellet's economical pink-noise approximation. Cheap and good enough
  // for audio cues — we're driving a heavy filter on top of it anyway.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

/** Clamp a configured volume / strength field to `[min, max]` with a default. */
export function clampNumber(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

/**
 * Ramp a parameter to `target` over `seconds` using `setTargetAtTime` —
 * exponentially asymptotic, which avoids the click of a `setValueAtTime` step
 * and the zipper of native polling on plain `.value` assignment.
 *
 * Per Web Audio convention, the time constant ≈ `seconds / 3` reaches ~95% of
 * the target by `seconds`.
 */
export function rampParam(param: AudioParam, target: number, seconds: number, now: number): void {
  // Cancel any in-flight ramp so successive calls don't pile up. Using a tiny
  // setValueAtTime at `now` pins the current value before scheduling the new
  // target — without it, `cancelScheduledValues` would discard the last
  // computed value.
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(target, now, Math.max(0.001, seconds / 3));
}
