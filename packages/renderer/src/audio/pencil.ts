import type { StrokeAudioInfo, TegakiAudioContext, TegakiAudioDriver, TegakiAudioInstance } from '../core/audio-registry.ts';
import { clampNumber, createNoiseBuffer, rampParam } from './utils.ts';

export interface PencilAudioConfig {
  /**
   * Overall loudness multiplier on top of the runtime's shared volume. Use
   * `0` to mute without unregistering. Default: `0.6`.
   */
  gain?: number;
  /**
   * Bandpass centre frequency in Hz. Lower values sound softer/duller, higher
   * sound harder/scratchier. Default: `3500`.
   */
  frequency?: number;
  /**
   * Bandpass Q. Higher Q = narrower band = more "tonal" scratch. Default: `1.2`.
   */
  q?: number;
  /**
   * Attack / release time in seconds when a stroke starts / ends. Default: `0.03` / `0.05`.
   */
  attack?: number;
  release?: number;
}

interface State {
  ctx: AudioContext;
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  shaperLFO: OscillatorNode;
  lfoGain: GainNode;
  gain: GainNode;
  active: number;
  cfg: Required<PencilAudioConfig>;
}

const defaults: Required<PencilAudioConfig> = {
  gain: 0.6,
  frequency: 3500,
  q: 1.2,
  attack: 0.03,
  release: 0.05,
};

function resolve(config: PencilAudioConfig | undefined): Required<PencilAudioConfig> {
  if (!config) return defaults;
  return {
    gain: clampNumber(config.gain, defaults.gain, 0, 4),
    frequency: clampNumber(config.frequency, defaults.frequency, 100, 18000),
    q: clampNumber(config.q, defaults.q, 0.1, 30),
    attack: clampNumber(config.attack, defaults.attack, 0, 1),
    release: clampNumber(config.release, defaults.release, 0, 2),
  };
}

/**
 * Procedural pencil-on-paper. Continuous bandpassed white noise, gated by a
 * gain envelope that ramps up while at least one stroke is active. A slow LFO
 * jitters the filter centre frequency to add the irregular "scratch" texture
 * that distinguishes pencil from generic filtered noise.
 *
 * Zero assets — works offline, every instance shares only a noise buffer.
 */
export const pencilAudio: TegakiAudioDriver<PencilAudioConfig> = {
  name: 'pencil',
  create(ctx: TegakiAudioContext, config: PencilAudioConfig): TegakiAudioInstance {
    const audioCtx = ctx.ctx;
    const cfg = resolve(config);

    const buffer = createNoiseBuffer(audioCtx, 2, 'white');
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cfg.frequency;
    filter.Q.value = cfg.q;

    // LFO -> filter frequency. Audio-rate-ish wobble that gives the
    // characteristic "scratch" rather than a uniform shhh.
    const shaperLFO = audioCtx.createOscillator();
    shaperLFO.type = 'sawtooth';
    shaperLFO.frequency.value = 23; // intentionally non-musical, irregular feel
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = cfg.frequency * 0.18;
    shaperLFO.connect(lfoGain).connect(filter.frequency);

    const gain = audioCtx.createGain();
    gain.gain.value = 0;

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    shaperLFO.start();

    const state: State = { ctx: audioCtx, source, filter, shaperLFO, lfoGain, gain, active: 0, cfg };

    return {
      onStrokeStart(info: StrokeAudioInfo): void {
        state.active++;
        const target = clampStrokeGain(info.width) * cfg.gain;
        rampParam(gain.gain, target, cfg.attack, audioCtx.currentTime);
      },
      onStrokeEnd(): void {
        state.active = Math.max(0, state.active - 1);
        if (state.active === 0) {
          rampParam(gain.gain, 0, cfg.release, audioCtx.currentTime);
        }
      },
      silence(): void {
        state.active = 0;
        // Instant cut rather than the normal release — the engine has either
        // paused or seeked, and a lingering tail would feel laggy.
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
          shaperLFO.stop();
        } catch {
          /* already stopped */
        }
        source.disconnect();
        filter.disconnect();
        lfoGain.disconnect();
        shaperLFO.disconnect();
        gain.disconnect();
      },
    };
  },
};

/**
 * Map a stroke's CSS-px width to a per-voice gain target. Thicker strokes are
 * a touch louder, but the curve is gentle so an arbitrary font scale doesn't
 * blow the levels.
 */
function clampStrokeGain(widthPx: number): number {
  // 1.0 at ~6px, 1.3 at ~12px, asymptotic to ~1.5.
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1;
  return 1 + 0.5 * (1 - Math.exp(-widthPx / 8));
}
