/**
 * Per-stroke information passed to audio drivers when a stroke begins or ends.
 * The runtime assigns a monotonically-increasing `id` so drivers can correlate
 * a `start` with its corresponding `end` even when strokes overlap.
 */
export interface StrokeAudioInfo {
  /** Monotonically-increasing id assigned by the runtime. Stable for the lifetime of the timeline. */
  id: number;
  /** Estimated stroke width in CSS pixels at the rendered size (avg width of the bundled points). */
  width: number;
  /** Stroke animation duration in seconds. */
  duration: number;
  /** The grapheme this stroke belongs to (useful for stylistic decisions). */
  char: string;
}

/**
 * The output target a driver should connect its final node to. The runtime
 * inserts a master gain node between this and the actual destination so a
 * uniform `volume` config can be applied without each driver re-implementing it.
 */
export interface TegakiAudioContext {
  readonly ctx: AudioContext;
  readonly destination: AudioNode;
}

export interface TegakiAudioInstance {
  /** Called when a stroke transitions from "not yet drawing" to "currently drawing". */
  onStrokeStart(info: StrokeAudioInfo): void;
  /** Called when a stroke transitions from "currently drawing" to "finished". */
  onStrokeEnd(info: StrokeAudioInfo): void;
  /**
   * Optional per-frame callback while at least one stroke is active. `dt` is
   * the elapsed seconds since the last call. Use for continuous modulation
   * (filter sweeps, granular scheduling) that shouldn't depend on stroke edges.
   */
  onTick?(activeCount: number, dt: number): void;
  /**
   * Soft kill — stop any in-flight voices but keep the instance usable for
   * subsequent strokes. Called on engine pause, seek, and restart.
   */
  silence?(): void;
  /** Release any AudioNodes the instance owns. Called on swap or engine destroy. */
  destroy(): void;
}

/**
 * An audio driver — a recipe for turning stroke events into sound. Drivers are
 * registered globally by name (like font bundles) and referenced from the
 * `sound` engine option. The driver itself is stateless; per-engine state lives
 * in the `TegakiAudioInstance` returned by `create()`.
 */
export interface TegakiAudioDriver<Config = Record<string, unknown>> {
  /** Registry key. Must be unique across registered drivers. */
  readonly name: string;
  /** Construct a fresh instance bound to an AudioContext and config. */
  create(ctx: TegakiAudioContext, config: Config): TegakiAudioInstance;
}

const drivers = new Map<string, TegakiAudioDriver<any>>();

/**
 * Register an audio driver under its `name`. Pass `null` to clear every
 * registered driver (mainly useful for tests). Re-registering a name replaces
 * the previous driver — already-instantiated engine instances keep their old
 * instance until the `sound` option is changed.
 */
export function registerAudio(driver: TegakiAudioDriver<any> | null): void {
  if (driver === null) {
    drivers.clear();
    return;
  }
  drivers.set(driver.name, driver);
}

/** Unregister a single driver by name. Returns whether it was present. */
export function unregisterAudio(name: string): boolean {
  return drivers.delete(name);
}

/** Look up a registered driver by name. */
export function getAudio(name: string): TegakiAudioDriver<any> | undefined {
  return drivers.get(name);
}

/** Snapshot of every registered driver's name. */
export function listAudio(): string[] {
  return [...drivers.keys()];
}

/**
 * The `sound` engine option. Several shapes are accepted:
 * - `string` — name of a registered driver, default config.
 * - object with `name` — same, plus driver-specific config and a shared `volume`.
 * - direct `TegakiAudioDriver` — bypass the registry (rare; useful for one-off drivers).
 * - `false` / `null` / `undefined` — no audio.
 */
export type TegakiSoundProp =
  | false
  | null
  | undefined
  | string
  | TegakiAudioDriver<any>
  | ({ name: string; volume?: number } & Record<string, unknown>);
