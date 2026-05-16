import type { StrokeAudioInfo, TegakiAudioContext, TegakiAudioDriver, TegakiAudioInstance } from '../core/audio-registry.ts';
import { clampNumber, createNoiseBuffer, rampParam } from './utils.ts';

export interface BrushAudioConfig {
  /** Overall loudness multiplier. Default: `0.7`. */
  gain?: number;
  /** Bandpass low corner. Brush sound lives in the low/mid band — keep below ~1500. Default: `800`. */
  frequency?: number;
  /** Bandpass Q. Default: `0.7` — wide, "wooshy". */
  q?: number;
  /** Attack / release in seconds. Brush is soft, so the defaults are slow. Default: `0.08` / `0.15`. */
  attack?: number;
  release?: number;
}

const defaults: Required<BrushAudioConfig> = {
  gain: 0.7,
  frequency: 800,
  q: 0.7,
  attack: 0.08,
  release: 0.15,
};

function resolve(config: BrushAudioConfig | undefined): Required<BrushAudioConfig> {
  if (!config) return defaults;
  return {
    gain: clampNumber(config.gain, defaults.gain, 0, 4),
    frequency: clampNumber(config.frequency, defaults.frequency, 80, 6000),
    q: clampNumber(config.q, defaults.q, 0.1, 20),
    attack: clampNumber(config.attack, defaults.attack, 0, 2),
    release: clampNumber(config.release, defaults.release, 0, 3),
  };
}

/**
 * Procedural brush / ink-pen. Same continuous-noise recipe as `pencilAudio`
 * but darker and softer: bandpass centred low (≈800 Hz), wider Q, and a slow
 * LFO sweep on the filter cutoff for the characteristic "swish" rather than
 * "scratch". Pink noise instead of white pushes more energy into the low end,
 * which sells the bristle weight.
 *
 * This is the least sample-accurate of the built-in drivers — a real brush
 * has bristle variability that's hard to fake — but it costs zero KB and
 * carries the "something soft is moving" cue convincingly enough for a UI.
 * Users who want pristine realism can swap in a sample-based driver via the
 * same `TegakiAudioDriver` interface.
 */
export const brushAudio: TegakiAudioDriver<BrushAudioConfig> = {
  name: 'brush',
  create(ctx: TegakiAudioContext, config: BrushAudioConfig): TegakiAudioInstance {
    const audioCtx = ctx.ctx;
    const cfg = resolve(config);

    const buffer = createNoiseBuffer(audioCtx, 3, 'pink');
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cfg.frequency;
    filter.Q.value = cfg.q;

    // Slow filter sweep — gives the "swooshing across paper" sense rather than
    // the constant hiss of a fixed-bandpass.
    const sweepLFO = audioCtx.createOscillator();
    sweepLFO.type = 'sine';
    sweepLFO.frequency.value = 0.9;
    const sweepGain = audioCtx.createGain();
    sweepGain.gain.value = cfg.frequency * 0.4;
    sweepLFO.connect(sweepGain).connect(filter.frequency);

    const gain = audioCtx.createGain();
    gain.gain.value = 0;

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    sweepLFO.start();

    let active = 0;

    return {
      onStrokeStart(info: StrokeAudioInfo): void {
        active++;
        // Thicker strokes nudge the filter slightly higher, giving a brighter
        // "wet" sound; thin strokes keep the dry/low cast.
        const widthBoost = 1 + Math.min(0.3, info.width / 40);
        rampParam(filter.frequency, cfg.frequency * widthBoost, cfg.attack, audioCtx.currentTime);
        rampParam(gain.gain, cfg.gain, cfg.attack, audioCtx.currentTime);
      },
      onStrokeEnd(): void {
        active = Math.max(0, active - 1);
        if (active === 0) {
          rampParam(gain.gain, 0, cfg.release, audioCtx.currentTime);
          rampParam(filter.frequency, cfg.frequency, cfg.release, audioCtx.currentTime);
        }
      },
      silence(): void {
        active = 0;
        gain.gain.cancelScheduledValues(audioCtx.currentTime);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
      },
      destroy(): void {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        try {
          sweepLFO.stop();
        } catch {
          /* already stopped */
        }
        source.disconnect();
        filter.disconnect();
        sweepGain.disconnect();
        sweepLFO.disconnect();
        gain.disconnect();
      },
    };
  },
};
