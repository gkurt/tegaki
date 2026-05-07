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
let { text, font, time: timeProp, onComplete, onChangeTimeline, effects, quality, timing, showOverlay, direction, shaper, class: className, style: userStyle, ...attrs }: Props = $props();

let container = $state<HTMLDivElement | undefined>();
let engine = $state<TegakiEngine | null>(null);

const engineOptions: TegakiEngineOptions = $derived({
  text,
  font,
  time: timeProp,
  effects: effects as Record<string, any>,
  quality,
  timing,
  showOverlay,
  direction,
  shaper,
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

// Compute initial HTML once — after the engine adopts, all updates go through engine.update().
const { rootProps, content: innerHtml } = TegakiEngine.renderElements(
  { text, font, time: timeProp, effects: effects as Record<string, any>, quality, timing, showOverlay, direction, shaper, onComplete, onChangeTimeline },
  svelteCreateElement,
);

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

// biome-ignore lint/correctness/noUnusedVariables: used in Svelte template
const rootStyleStr = styleToString(rootProps.style) + (userStyle ? `;${userStyle}` : '');

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
