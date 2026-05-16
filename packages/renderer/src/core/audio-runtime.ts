import type { Timeline } from '../lib/timeline.ts';
import { lookupGlyphData } from '../lib/utils.ts';
import type { TegakiBundle } from '../types.ts';
import {
  getAudio,
  type StrokeAudioInfo,
  type TegakiAudioDriver,
  type TegakiAudioInstance,
  type TegakiSoundProp,
} from './audio-registry.ts';

interface ResolvedSound {
  driver: TegakiAudioDriver<any>;
  config: Record<string, unknown>;
  volume: number;
}

/**
 * Resolve a `sound` engine option into a driver + config. Returns `null` when
 * audio is disabled or the named driver isn't registered (logs a single
 * warning per missing name so a typo doesn't spam the console).
 */
const warnedMissing = new Set<string>();
export function resolveSoundProp(prop: TegakiSoundProp): ResolvedSound | null {
  if (!prop) return null;
  if (typeof prop === 'string') {
    const driver = getAudio(prop);
    if (!driver) {
      if (!warnedMissing.has(prop)) {
        warnedMissing.add(prop);
        console.warn(`[tegaki] No audio driver registered for "${prop}". Call TegakiEngine.registerAudio() first.`);
      }
      return null;
    }
    return { driver, config: {}, volume: 1 };
  }
  if (typeof prop !== 'object') return null;
  if ('create' in prop && typeof prop.create === 'function') {
    return { driver: prop as TegakiAudioDriver, config: {}, volume: 1 };
  }
  if ('name' in prop && typeof prop.name === 'string') {
    const objProp = prop as { name: string; volume?: number } & Record<string, unknown>;
    const driver = getAudio(objProp.name);
    if (!driver) {
      if (!warnedMissing.has(objProp.name)) {
        warnedMissing.add(objProp.name);
        console.warn(`[tegaki] No audio driver registered for "${objProp.name}". Call TegakiEngine.registerAudio() first.`);
      }
      return null;
    }
    const { name, volume, ...rest } = objProp;
    void name;
    return { driver, config: rest, volume: typeof volume === 'number' ? volume : 1 };
  }
  return null;
}

interface StrokeEvent extends StrokeAudioInfo {
  startTime: number;
  endTime: number;
}

/**
 * Owns the AudioContext, master gain, and active driver instance. Translates
 * the engine's monotonically-increasing time into per-stroke `start`/`end`
 * events the driver consumes.
 *
 * One runtime per engine instance. Drivers can be swapped without rebuilding
 * the context (`setSound`) — useful for hot-swapping or A/B preview.
 */
export class AudioRuntime {
  private _audioCtx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  private _instance: TegakiAudioInstance | null = null;
  private _driver: TegakiAudioDriver<any> | null = null;
  private _volume = 1;
  private _suspended = false;

  // Strokes sorted by startTime ascending. Indexed by their position; the
  // index is also the StrokeAudioInfo.id so the runtime can look the event up
  // by id without an extra map.
  private _strokes: StrokeEvent[] = [];
  private _nextStartIdx = 0;
  private _active = new Set<number>();
  private _lastTime = -Infinity;
  private _lastTickTime = -Infinity;

  setSound(prop: TegakiSoundProp): void {
    const resolved = resolveSoundProp(prop);
    if (!resolved) {
      this._teardownInstance();
      return;
    }

    // Same driver, config change only — just update master volume; driver-specific
    // config changes require a recreate (drivers may have baked params into nodes).
    if (this._driver === resolved.driver && this._instance) {
      this._setVolume(resolved.volume);
      return;
    }

    this._teardownInstance();
    const ctx = this._ensureContext();
    if (!ctx) return; // SSR / no Web Audio
    const masterGain = this._masterGain!;
    this._volume = resolved.volume;
    masterGain.gain.value = resolved.volume;
    this._driver = resolved.driver;
    try {
      this._instance = resolved.driver.create({ ctx, destination: masterGain }, resolved.config);
    } catch (err) {
      console.warn(`[tegaki] Audio driver "${resolved.driver.name}" failed to initialize:`, err);
      this._instance = null;
      this._driver = null;
    }
  }

  /**
   * Recompute the sorted stroke event list. Call whenever timeline, font,
   * fontSize, or unitsPerEm changes — the events bake stroke widths in CSS
   * pixels for the current render size.
   *
   * Also resets the start/active pointers since the previous events are no
   * longer valid; the runtime won't fire spurious end events for stale strokes.
   */
  rebuildStrokes(timeline: Timeline, font: TegakiBundle | null, fontSize: number): void {
    this._silenceActive();
    this._strokes = [];
    this._nextStartIdx = 0;
    this._lastTime = -Infinity;
    this._lastTickTime = -Infinity;

    if (!font || !timeline.entries.length || !fontSize) return;

    const scale = fontSize / font.unitsPerEm;
    let id = 0;
    for (const entry of timeline.entries) {
      if (!entry.hasGlyph) continue;
      const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
      if (!glyph) continue;
      const tScale = entry.strokeTimeScale ?? 1;
      for (let i = 0; i < glyph.s.length; i++) {
        const stroke = glyph.s[i]!;
        const delay = entry.strokeDelays?.[i] ?? stroke.d * tScale;
        const duration = stroke.a * tScale;
        if (duration <= 0) continue;
        // Average bundled stroke width in font units; convert to CSS px via the
        // current render scale.
        let widthSum = 0;
        for (const pt of stroke.p) widthSum += pt[2];
        const avgWidthFU = stroke.p.length ? widthSum / stroke.p.length : 0;
        const startTime = entry.offset + delay;
        this._strokes.push({
          id: id++,
          startTime,
          endTime: startTime + duration,
          width: avgWidthFU * scale,
          duration,
          char: entry.char,
        });
      }
    }

    this._strokes.sort((a, b) => a.startTime - b.startTime);
    // Renumber so `id` matches index after sort — keeps id-as-index lookups valid.
    for (let i = 0; i < this._strokes.length; i++) this._strokes[i]!.id = i;
  }

  /**
   * Advance to `currentTime`. Fires start events for strokes that begin in
   * `(lastTime, currentTime]` and end events for any active stroke whose
   * `endTime` is now in the past. A backward jump (controlled-mode scrub) is
   * treated as a silent reset — no events fire on the jump itself.
   */
  advance(currentTime: number): void {
    if (!this._instance) return;

    if (currentTime < this._lastTime) {
      this._silenceActive();
      this._lastTime = -Infinity;
      this._nextStartIdx = 0;
    }

    // Start events: process every stroke whose startTime is now ≤ currentTime.
    // Strokes that started AND ended within (lastTime, currentTime] (e.g. a
    // forward scrub spanning multiple full strokes) are skipped silently —
    // there's no useful sound to play for a stroke whose entire duration is
    // already in the past.
    while (this._nextStartIdx < this._strokes.length && this._strokes[this._nextStartIdx]!.startTime <= currentTime) {
      const ev = this._strokes[this._nextStartIdx]!;
      if (ev.endTime > currentTime) {
        this._active.add(ev.id);
        try {
          this._instance.onStrokeStart(ev);
        } catch (err) {
          console.warn('[tegaki] audio onStrokeStart threw:', err);
        }
      }
      this._nextStartIdx++;
    }

    // End events for any active stroke whose endTime is past.
    if (this._active.size > 0) {
      const ended: number[] = [];
      for (const id of this._active) {
        if (this._strokes[id]!.endTime <= currentTime) ended.push(id);
      }
      for (const id of ended) {
        this._active.delete(id);
        try {
          this._instance.onStrokeEnd(this._strokes[id]!);
        } catch (err) {
          console.warn('[tegaki] audio onStrokeEnd threw:', err);
        }
      }
    }

    if (this._active.size > 0 && this._instance.onTick) {
      const dt = this._lastTickTime === -Infinity ? 0 : Math.max(0, currentTime - this._lastTickTime);
      try {
        this._instance.onTick(this._active.size, dt);
      } catch (err) {
        console.warn('[tegaki] audio onTick threw:', err);
      }
    }
    this._lastTickTime = currentTime;
    this._lastTime = currentTime;
  }

  /** Engine paused — suspend the AudioContext (cheap on most browsers, frees DSP). */
  pause(): void {
    if (this._suspended || !this._audioCtx) return;
    this._suspended = true;
    void this._audioCtx.suspend().catch(() => {
      /* no-op: suspension is best-effort */
    });
  }

  /** Engine resumed — resume the AudioContext. May be required after browser autoplay gating. */
  resume(): void {
    if (!this._suspended || !this._audioCtx) return;
    this._suspended = false;
    void this._audioCtx.resume().catch(() => {
      /* no-op */
    });
  }

  /** Forfeit any in-flight voices and stroke state. Used on seek/restart. */
  silence(): void {
    this._silenceActive();
    this._nextStartIdx = 0;
    this._lastTime = -Infinity;
    this._lastTickTime = -Infinity;
  }

  destroy(): void {
    this._teardownInstance();
    if (this._audioCtx) {
      void this._audioCtx.close().catch(() => {
        /* no-op */
      });
      this._audioCtx = null;
      this._masterGain = null;
    }
  }

  // -------------------------------------------------------------------------

  private _ensureContext(): AudioContext | null {
    if (this._audioCtx) return this._audioCtx;
    if (typeof window === 'undefined') return null;
    const Ctor: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this._audioCtx = new Ctor();
    } catch {
      return null;
    }
    this._masterGain = this._audioCtx.createGain();
    this._masterGain.gain.value = this._volume;
    this._masterGain.connect(this._audioCtx.destination);
    return this._audioCtx;
  }

  private _silenceActive(): void {
    if (!this._instance) {
      this._active.clear();
      return;
    }
    if (this._instance.silence) {
      try {
        this._instance.silence();
      } catch (err) {
        console.warn('[tegaki] audio silence threw:', err);
      }
      this._active.clear();
      return;
    }
    // No silence() — synthesise end events so the driver can shut its voices down cleanly.
    for (const id of this._active) {
      try {
        this._instance.onStrokeEnd(this._strokes[id]!);
      } catch {
        /* no-op */
      }
    }
    this._active.clear();
  }

  private _teardownInstance(): void {
    this._silenceActive();
    if (this._instance) {
      try {
        this._instance.destroy();
      } catch (err) {
        console.warn('[tegaki] audio destroy threw:', err);
      }
    }
    this._instance = null;
    this._driver = null;
  }

  private _setVolume(v: number): void {
    this._volume = v;
    if (this._masterGain) this._masterGain.gain.value = v;
  }
}
