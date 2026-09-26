import type { TegakiFrame, TegakiPlugin } from 'tegaki/core';

/** Timeline seconds between two frames beyond which the second is a jump (a seek, a loop), not playback. */
const MAX_STEP = 0.25;

/** How far the pens moved from one frame to the next, and how many strokes were set down. */
export function penMotion(frame: TegakiFrame, prev: TegakiFrame | null): { distance: number; dt: number; touches: number } | null {
  if (!prev) return null;
  const dt = frame.time - prev.time;
  if (dt <= 0 || dt > MAX_STEP) return null;
  const before = new Map(prev.strokes.map((s) => [s.id, s]));
  let distance = 0;
  let touches = 0;
  for (const s of frame.strokes) {
    const p = before.get(s.id);
    if (!p || s.state === 'pending') continue;
    if (p.state === 'pending') touches++;
    // Ink laid since the last frame: the stretch of path between the two progresses.
    if (p.state !== 'done') distance += s.path.length * (s.progress - p.progress);
  }
  return { distance, dt, touches };
}

interface Voice {
  audio: AudioContext;
  scratch: GainNode;
  band: BiquadFilterNode;
  tap: GainNode;
}

let shared: Voice | null = null;

/** One audio graph for every sound plugin: looping noise, band-passed into a scratch and low-passed into a tap. */
function voice(): Voice | null {
  if (shared) return shared;
  if (typeof AudioContext === 'undefined') return null;
  const audio = new AudioContext();
  const noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  source.buffer = noise;
  source.loop = true;

  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3000;
  band.Q.value = 0.9;
  const scratch = audio.createGain();
  scratch.gain.value = 0;
  source.connect(band).connect(scratch).connect(audio.destination);

  const low = audio.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 900;
  const tap = audio.createGain();
  tap.gain.value = 0;
  source.connect(low).connect(tap).connect(audio.destination);

  source.start();
  shared = { audio, scratch, band, tap };
  return shared;
}

/** Hold a param where it is now, dropping what was scheduled after (Firefox has no cancelAndHoldAtTime). */
function hold(param: AudioParam, at: number) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
  else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
  }
}

/**
 * A pencil on paper: a scratch that follows how fast the ink is being laid
 * down, and a soft tap each time a stroke starts. An `onFrame` plugin — it
 * paints nothing, it listens to the frames. Frames that jump (a seek, a loop,
 * a resize repeating the time) stay silent, and the scratch fades on its own
 * when frames stop coming, so pausing or switching the plugin off goes quiet.
 * Browsers start audio only after a click or key press on the page.
 */
export function soundPlugin(): TegakiPlugin {
  // Speed that counts as loud, learnt from the text being written.
  let peak = 0;
  return {
    name: 'sound',
    onFrame(frame, prev) {
      const motion = penMotion(frame, prev);
      if (!motion) return;
      const v = voice();
      if (!v) return;
      if (v.audio.state === 'suspended') void v.audio.resume().catch(() => {});
      const now = v.audio.currentTime;
      const speed = motion.distance / motion.dt;
      peak = Math.max(peak * 0.995, speed);
      const level = peak > 0 ? speed / peak : 0;

      hold(v.scratch.gain, now);
      v.scratch.gain.setTargetAtTime(0.16 * level ** 0.7 * (0.8 + 0.4 * Math.random()), now, 0.015);
      // Until the next frame says otherwise, fade out.
      v.scratch.gain.setTargetAtTime(0, now + 0.08, 0.04);
      hold(v.band.frequency, now);
      v.band.frequency.setTargetAtTime(1800 + 2600 * level, now, 0.03);

      if (motion.touches > 0) {
        hold(v.tap.gain, now);
        v.tap.gain.setValueAtTime(0.5, now);
        v.tap.gain.setTargetAtTime(0, now, 0.018);
      }
    },
  };
}
