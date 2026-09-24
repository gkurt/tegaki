/**
 * Features that harfbuzz's (and the browser's) complex-text shapers apply
 * context-sensitively based on the script. Passing them in an explicit
 * "enable" list tells the shaper to apply them unconditionally to the whole
 * text range, which breaks the positional assignment — e.g. every Arabic
 * glyph collapses to the final form.
 *
 * The fraction features (`frac`/`numr`/`dnom`) are the same kind: shapers
 * apply them around a fraction slash on their own, and a blanket enable turns
 * every digit into a numerator. It doesn't even do that consistently — a font
 * may register them for one script only (Amiri: Arabic), so the browser, which
 * shapes digits beside Arabic as Arabic, draws numerators where our per-word
 * harfbuzz shaping, seeing bare digits, draws plain ones.
 *
 * Trust the shaper's script defaults for these and never emit them as
 * explicit enables. (Explicit *disables* are fine — `-fina` suppressing the
 * automatic fina is exactly the user's intent.)
 */
const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig', 'frac', 'numr', 'dnom']);

/**
 * Build a CSS `font-feature-settings` value from bundle features. Same
 * filter as the HB path: shaper-managed tags are omitted so browsers keep
 * their contextual positional assignment.
 *
 * Fonts with no declared features fall back to disabling `liga` + `calt`,
 * which matches the legacy "1:1 char-to-glyph" assumption the renderer
 * makes when it can't shape.
 */
export function toCssFeatureSettings(enabled: readonly string[]): string {
  if (enabled.length === 0) return "'calt' 0, 'liga' 0";
  const explicit = enabled.filter((tag) => !SHAPER_MANAGED_FEATURES.has(tag));
  if (explicit.length === 0) return 'normal';
  return explicit.map((f) => `'${f}' 1`).join(', ');
}
