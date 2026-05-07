<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { TegakiEngine } from '../core/engine.ts';
import type { TegakiEngineOptions, TegakiQuality, TimeControlProp } from '../core/types.ts';
import type { TegakiBundle, TegakiEffects } from '../types.ts';
import type { Timeline, TimelineConfig } from '../lib/timeline.ts';

const props = defineProps<{
  text?: string;
  font?: TegakiBundle | string;
  time?: TimeControlProp;
  effects?: TegakiEffects<Record<string, any>>;
  timing?: TimelineConfig;
  quality?: TegakiQuality;
  showOverlay?: boolean;
  onComplete?: () => void;
  onChangeTimeline?: (timeline: Timeline) => void;
  direction?: 'ltr' | 'rtl';
  shaper?: boolean;
}>();

defineOptions({ inheritAttrs: false });

const container = ref<HTMLDivElement>();
let engine: TegakiEngine | null = null;

const engineOptions = computed<TegakiEngineOptions>(() => ({
  text: props.text,
  font: props.font,
  time: props.time,
  effects: props.effects as Record<string, any>,
  quality: props.quality,
  timing: props.timing,
  showOverlay: props.showOverlay,
  direction: props.direction,
  shaper: props.shaper,
  onComplete: props.onComplete,
  onChangeTimeline: props.onChangeTimeline,
}));

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlCreateElement(tag: string, nodeProps: Record<string, any>, ...children: string[]): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(nodeProps)) {
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

// Compute initial HTML once — after the engine adopts, all updates go through engine.update().
const { rootProps, content: innerHtml } = TegakiEngine.renderElements(engineOptions.value, htmlCreateElement);

onMounted(() => {
  if (!container.value) return;
  engine = new TegakiEngine(container.value, { ...engineOptions.value, adopt: true });
});

onUnmounted(() => {
  engine?.destroy();
  engine = null;
});

watch(
  engineOptions,
  (options) => {
    engine?.update(options);
  },
  { deep: true },
);

defineExpose({ engine, element: container });
</script>

<template>
  <div ref="container" data-tegaki="root" dir="auto" :style="rootProps.style" v-bind="$attrs" v-html="innerHtml" />
</template>
