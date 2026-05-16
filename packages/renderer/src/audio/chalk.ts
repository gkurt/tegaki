import type { StrokeAudioInfo, TegakiAudioContext, TegakiAudioDriver, TegakiAudioInstance } from '../core/audio-registry.ts';
import { clampNumber, createNoiseBuffer } from './utils.ts';

export interface ChalkAudioConfig {
  /** Overall loudness multiplier. Default: `0.5`. */
  gain?: number;
  /** Average grains per second while a stroke is active. Default: `45`. */
  grainRate?: number;
  /**
   * Probability per grain of being a tonal "squeak" instead of a noise burst.
   * `0` disables squeaks entirely. Default: `0.012`.
   */
  squeakChance?: number;
}

const defaults: Required<ChalkAudioConfig> = {
  gain: 0.5,
  grainRate: 45,
  squeakChance: 0.012,
};

function resolve(config: ChalkAudioConfig | undefined): Required<ChalkAudioConfig> {
  if (!config) return defaults;
  return {
    gain: clampNumber(config.gain, defaults.gain, 0, 4),
    grainRate: clampNumber(config.grainRate, defaults.grainRate, 1, 500),
    squeakChance: clampNumber(config.squeakChance, defaults.squeakChance, 0, 1),
  };
}

/**
 * Procedural chalkboard. Doesn't loop a continuous source — instead, while at
 * least one stroke is active, the driver schedules short noise grains at the
 * configured rate. Each grain is a quick bandpassed burst with a fast attack
 * and a few-ms decay, occasionally upgraded to a brief tonal squeak. The
 * irregular, sparse texture is what makes a chalk recording recognisable
 * versus filtered hiss.
 *
 * Grains are scheduled on the audio thread (`start(time)`), so AudioContext
 * suspension cleanly halts them without any teardown bookkeeping.
 */
export const chalkAudio: TegakiAudioDriver<ChalkAudioConfig> = {
  name: 'chalk',
  create(ctx: TegakiAudioContext, config: ChalkAudioConfig): TegakiAudioInstance {
    const audioCtx = ctx.ctx;
    const cfg = resolve(config);
    const buffer = createNoiseBuffer(audioCtx, 0.5, 'white');
    const masterOut = ctx.destination;

    const activeWidths = new Map<number, number>();
    let grainBudget = 0; // accumulated grains; drains as we schedule them

    function scheduleGrain(now: number, widthPx: number, isSqueak: boolean): void {
      const duration = isSqueak ? 0.06 + Math.random() * 0.05 : 0.012 + Math.random() * 0.018;
      const startAt = now + Math.random() * 0.01;
      const envelope = audioCtx.createGain();
      envelope.gain.setValueAtTime(0, startAt);
      envelope.gain.linearRampToValueAtTime(1, startAt + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      const filter = audioCtx.createBiquadFilter();
      if (isSqueak) {
        filter.type = 'bandpass';
        filter.frequency.value = 1800 + Math.random() * 1400;
        filter.Q.value = 18;
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = filter.frequency.value;
        osc.connect(filter).connect(envelope).connect(masterOut);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.02);
      } else {
        filter.type = 'bandpass';
        filter.frequency.value = 4500 + Math.random() * 4500;
        filter.Q.value = 2 + Math.random() * 4;
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = 0.7 + Math.random() * 0.6;
        // Random offset so successive grains aren't correlated, which would
        // create an audible pitch from the periodicity of the loop.
        const offset = Math.random() * (buffer.duration - 0.1);
        src.connect(filter).connect(envelope).connect(masterOut);
        src.start(startAt, offset, duration + 0.05);
        src.stop(startAt + duration + 0.05);
      }

      // Per-grain amplitude. Thicker strokes give slightly louder grains and
      // a touch more low-end via filter Q (handled above).
      const widthScale = 0.7 + 0.4 * (1 - Math.exp(-widthPx / 10));
      envelope.gain.cancelScheduledValues(startAt);
      envelope.gain.setValueAtTime(0, startAt);
      envelope.gain.linearRampToValueAtTime(widthScale * cfg.gain, startAt + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    }

    return {
      onStrokeStart(info: StrokeAudioInfo): void {
        activeWidths.set(info.id, info.width);
      },
      onStrokeEnd(info: StrokeAudioInfo): void {
        activeWidths.delete(info.id);
      },
      onTick(_activeCount: number, dt: number): void {
        // Budget-driven scheduler: we add `rate * dt` grains-worth of credit
        // each tick and emit whole grains until the credit is exhausted. This
        // smooths over wildly variable frame intervals (rAF on a busy tab)
        // without bunching grains at the start of a long frame.
        grainBudget += cfg.grainRate * dt;
        while (grainBudget >= 1) {
          grainBudget -= 1;
          // Pick a random active stroke's width to inherit per-grain.
          let chosenWidth = 0;
          let n = 0;
          for (const w of activeWidths.values()) {
            n++;
            if (Math.random() < 1 / n) chosenWidth = w;
          }
          if (chosenWidth === 0) chosenWidth = 8;
          scheduleGrain(audioCtx.currentTime, chosenWidth, Math.random() < cfg.squeakChance);
        }
      },
      silence(): void {
        activeWidths.clear();
        grainBudget = 0;
        // No long-running source to kill — already-scheduled grains will fade
        // out on their own envelope. The runtime will suspend the context
        // immediately after this when pausing, which clips that tail naturally.
      },
      destroy(): void {
        activeWidths.clear();
        grainBudget = 0;
      },
    };
  },
};
