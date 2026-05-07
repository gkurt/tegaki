/** @jsxImportSource solid-js */
import { createEffect, createMemo, type JSX, on, onCleanup, onMount, splitProps } from 'solid-js';
import { TegakiEngine } from '../core/engine.ts';
import type { TegakiEngineOptions } from '../core/types.ts';
import type { TegakiEffects } from '../types.ts';

export interface TegakiRendererProps extends Omit<TegakiEngineOptions, 'effects'> {
  /** Visual effects applied during canvas rendering. */
  effects?: TegakiEffects<Record<string, any>>;
  class?: string;
  ref?: (handle: TegakiRendererHandle) => void;
  [key: string]: any;
}

export interface TegakiRendererHandle {
  readonly engine: TegakiEngine | null;
  readonly element: HTMLDivElement | null;
}

function solidCreateElement(tag: string, props: Record<string, any>, ...children: (JSX.Element | string)[]): JSX.Element {
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
  const content = children.map((c) => (typeof c === 'string' && !c.startsWith('<') ? escapeHtml(c) : (c as string))).join('');
  return `${open}${content}</${tag}>` as unknown as JSX.Element;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function TegakiRenderer(props: TegakiRendererProps) {
  const [local, divProps] = splitProps(props, [
    'text',
    'font',
    'time',
    'onComplete',
    'onChangeTimeline',
    'effects',
    'quality',
    'timing',
    'showOverlay',
    'direction',
    'shaper',
    'ref',
  ]);

  let container!: HTMLDivElement;
  let engine: TegakiEngine | null = null;

  const engineOptions = createMemo<TegakiEngineOptions>(() => ({
    text: local.text,
    font: local.font,
    time: local.time,
    effects: local.effects as Record<string, any>,
    quality: local.quality,
    timing: local.timing,
    showOverlay: local.showOverlay,
    direction: local.direction,
    shaper: local.shaper,
    onComplete: local.onComplete,
    onChangeTimeline: local.onChangeTimeline,
  }));

  // Compute initial HTML once — after the engine adopts, all updates go through engine.update().
  const { rootProps, content } = TegakiEngine.renderElements(engineOptions(), solidCreateElement);
  const innerHTML = content as unknown as string;

  onMount(() => {
    engine = new TegakiEngine(container, { ...engineOptions(), adopt: true });
    local.ref?.({ engine, element: container });
  });

  onCleanup(() => {
    engine?.destroy();
    engine = null;
  });

  createEffect(
    on(engineOptions, (options) => {
      engine?.update(options);
    }),
  );

  const mergedStyle = { ...rootProps.style, ...(typeof divProps.style === 'object' ? divProps.style : {}) };

  return <div ref={container!} data-tegaki="root" dir="auto" {...divProps} style={mergedStyle} innerHTML={innerHTML} />;
}
