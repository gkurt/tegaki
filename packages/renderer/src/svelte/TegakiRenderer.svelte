<script lang="ts">
import { untrack } from 'svelte';
import { TegakiEngine } from '../core/engine.ts';
import type { TegakiEngineOptions } from '../core/types.ts';
import type { TegakiEffects } from '../types.ts';

interface Props extends Omit<TegakiEngineOptions, 'effects'> {
  /** Visual effects applied during canvas rendering. */
  effects?: TegakiEffects<Record<string, any>>;
  class?: string;
  [key: string]: any;
}

// biome-ignore lint/correctness/noUnusedVariables: attrs is used in Svelte template
let { text, font, time: timeProp, reducedMotion, onComplete, onChangeTimeline, effects, quality, plugins, seed, timing, showOverlay, direction, shaper, fallbackFont, class: className, style: userStyle, ...attrs }: Props = $props();

let container = $state<HTMLDivElement | undefined>();
let engine = $state<TegakiEngine | null>(null);

const engineOptions: TegakiEngineOptions = $derived({
  text,
  font,
  time: timeProp,
  reducedMotion,
  effects: effects as Record<string, any>,
  quality,
  plugins,
  seed,
  timing,
  showOverlay,
  direction,
  shaper,
  fallbackFont,
  onComplete,
  onChangeTimeline,
});

function svelteCreateElement(tag: string, props: Record<string, any>, ...children: string[]): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'style' && typeof value === 'object') {
      const css = Object.entries(value)
        .filter(([, v]) => v != null)
        .map(([k, v]) => {
          const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          const val = typeof v === 'number' && !k.startsWith('--') ? `${v}px` : String(v);
          return `${prop}:${val}`;
        })
        .join(';');
      if (css) parts.push(`style="${escapeAttr(css)}"`);
    } else if (typeof value === 'boolean') {
      parts.push(key);
    } else {
      parts.push(`${key}="${escapeAttr(String(value))}"`);
    }
  }
  const open = parts.length > 0 ? `<${tag} ${parts.join(' ')}>` : `<${tag}>`;
  const content = children.map((c) => (typeof c === 'string' && !c.startsWith('<') ? escapeHtml(c) : c)).join('');
  return `${open}${content}</${tag}>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function styleToString(style: Record<string, any>): string {
  return Object.entries(style)
    .filter(([, v]) => v != null)
    .map(([k, v]) => {
      const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m: string) => `-${m.toLowerCase()}`);
      const val = typeof v === 'number' && !k.startsWith('--') ? `${v}px` : String(v);
      return `${prop}:${val}`;
    })
    .join(';');
}

/** A `style` prop as CSS text: a string as given, an object the way the other adapters take it. */
function cssText(style: unknown): string {
  return typeof style === 'string' ? style : style && typeof style === 'object' ? styleToString(style as Record<string, any>) : '';
}

// Rendered once, from the props at mount: the engine then adopts this markup,
// and later changes go through engine.update() and the style effect below.
const { rootProps, content: innerHtml } = untrack(() => TegakiEngine.renderElements(engineOptions, svelteCreateElement));
const baseStyleStr = styleToString(rootProps.style);

// Svelte would rewrite the whole attribute whenever this changed, wiping what
// the engine sets on the root (font-family, direction, the --tegaki-* time
// properties), so it stays as rendered and the effect below applies changes.
// biome-ignore lint/correctness/noUnusedVariables: used in Svelte template
const rootStyleStr = untrack(() => baseStyleStr + (userStyle ? `;${cssText(userStyle)}` : ''));

/** Root properties the engine keeps up to date itself, from its `font`, `direction` and clock. */
const engineOwned = (name: string) => name === 'font-family' || name === 'direction' || name.startsWith('--tegaki-');

/** Each declaration in `css` the engine doesn't own, by property: its value and priority. */
function declarations(css: string): Map<string, [string, string]> {
  const probe = document.createElement('div').style;
  probe.cssText = css;
  const out = new Map<string, [string, string]>();
  for (let i = 0; i < probe.length; i++) {
    const name = probe[i]!;
    if (!engineOwned(name)) out.set(name, [probe.getPropertyValue(name), probe.getPropertyPriority(name)]);
  }
  return out;
}

// The user's style, one property at a time (as React's style diffing does):
// a changed declaration is set, a dropped one goes back to the root's own
// value or away. Declarations the engine owns are left alone.
let appliedStyle = new Map<string, [string, string]>();
$effect(() => {
  const next = declarations(cssText(userStyle));
  if (!container) return;
  const el = container;
  const base = declarations(baseStyleStr);
  for (const name of appliedStyle.keys()) {
    if (next.has(name)) continue;
    const own = base.get(name);
    if (own) el.style.setProperty(name, ...own);
    else el.style.removeProperty(name);
  }
  for (const [name, [value, priority]] of next) {
    const was = appliedStyle.get(name);
    if (was?.[0] !== value || was?.[1] !== priority) el.style.setProperty(name, value, priority);
  }
  appliedStyle = next;
});

$effect(() => {
  if (!container) return;
  // Read engineOptions outside tracking to avoid re-running this effect on prop changes.
  // Prop updates are handled by the separate engine.update() effect below.
  const opts = untrack(() => engineOptions);
  const e = new TegakiEngine(container, { ...opts, adopt: true });
  engine = e;
  return () => {
    e.destroy();
    engine = null;
  };
});

$effect(() => {
  engine?.update(engineOptions);
});
</script>

<div bind:this={container} data-tegaki="root" dir="auto" style={rootStyleStr} class={className} {...attrs}>
  {@html innerHtml}
</div>
