/**
 * Built-in audio drivers for the tegaki renderer.
 *
 * Each driver is registered with `TegakiEngine.registerAudio` and then
 * referenced from the `sound` engine option by its `name` (`"pencil"`,
 * `"chalk"`, `"brush"`). All three are fully procedural — they use the Web
 * Audio API and ship zero audio assets, which keeps the package's footprint
 * small and lets you ship the sounds anywhere the renderer can run.
 *
 * @example
 * import { TegakiEngine } from 'tegaki/core';
 * import { brushAudio, chalkAudio, pencilAudio, registerBuiltInAudio } from 'tegaki/audio';
 *
 * // Register one:
 * TegakiEngine.registerAudio(pencilAudio);
 *
 * // Or register all three:
 * registerBuiltInAudio();
 *
 * // Then reference by name:
 * <TegakiRenderer sound="pencil" />
 * <TegakiRenderer sound={{ name: 'chalk', volume: 0.4, squeakChance: 0 }} />
 *
 * Custom drivers (e.g. sample-based) implement `TegakiAudioDriver` from
 * `tegaki/core` and register the same way.
 */
import { registerAudio } from '../core/audio-registry.ts';
import { brushAudio } from './brush.ts';
import { chalkAudio } from './chalk.ts';
import { pencilAudio } from './pencil.ts';

export type {
  StrokeAudioInfo,
  TegakiAudioContext,
  TegakiAudioDriver,
  TegakiAudioInstance,
  TegakiSoundProp,
} from '../core/audio-registry.ts';
export { type BrushAudioConfig, brushAudio } from './brush.ts';
export { type ChalkAudioConfig, chalkAudio } from './chalk.ts';
export { type PencilAudioConfig, pencilAudio } from './pencil.ts';

/**
 * Register all three built-in drivers (`pencil`, `chalk`, `brush`) in one call.
 * Equivalent to three `TegakiEngine.registerAudio()` calls. Safe to call
 * multiple times — re-registering replaces the previous entry.
 */
export function registerBuiltInAudio(): void {
  registerAudio(pencilAudio);
  registerAudio(chalkAudio);
  registerAudio(brushAudio);
}
