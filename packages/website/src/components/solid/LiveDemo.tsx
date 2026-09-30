/** @jsxImportSource solid-js */
import { createResource, Show } from 'solid-js';
import {
  globalGradientPlugin,
  glowPlugin,
  registerPlugin,
  strokeGradientPlugin,
  type TegakiBundle,
  type TegakiPluginSpec,
  taperPlugin,
  wobblePlugin,
} from 'tegaki/core';
import { TegakiRenderer } from 'tegaki/solid';

// The docs name the style plugins in MDX props (plain data), so register them here.
registerPlugin(glowPlugin, taperPlugin, wobblePlugin, strokeGradientPlugin, globalGradientPlugin);

async function loadBundle(): Promise<TegakiBundle> {
  const mod = await import('tegaki/fonts/caveat');
  return (mod as any).default;
}

export function LiveDemo(props: { text?: string; fontSize?: number; time?: any; plugins?: readonly TegakiPluginSpec[]; caption?: string }) {
  const [bundle] = createResource(loadBundle);

  return (
    <div class="not-content live-demo">
      <div class="live-demo-card">
        <Show when={bundle()} fallback={<div class="live-demo-loading">Loading...</div>}>
          {(b) => (
            <TegakiRenderer
              font={b()}
              text={props.text ?? 'Hello World'}
              time={props.time ?? { mode: 'uncontrolled', speed: 1, loop: true }}
              plugins={props.plugins}
              style={{ 'font-size': `${props.fontSize ?? 48}px` }}
            />
          )}
        </Show>
      </div>
      <Show when={props.caption}>
        <div class="live-demo-caption">{props.caption}</div>
      </Show>
    </div>
  );
}
