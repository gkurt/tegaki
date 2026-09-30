<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { TegakiRenderer } from 'tegaki/vue';
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

// The docs name the style plugins in MDX props (plain data), so register them here.
registerPlugin(glowPlugin, taperPlugin, wobblePlugin, strokeGradientPlugin, globalGradientPlugin);

const props = withDefaults(
  defineProps<{
    text?: string;
    fontSize?: number;
    time?: any;
    plugins?: readonly TegakiPluginSpec[];
    caption?: string;
  }>(),
  {
    text: 'Hello World',
    fontSize: 48,
    time: () => ({ mode: 'uncontrolled' as const, speed: 1, loop: true }),
  },
);

const bundle = shallowRef<TegakiBundle | null>(null);

onMounted(() => {
  import('tegaki/fonts/caveat').then((mod) => {
    bundle.value = (mod as any).default;
  });
});
</script>

<template>
  <div class="not-content live-demo">
    <div class="live-demo-card">
      <TegakiRenderer
        v-if="bundle"
        :font="bundle"
        :text="props.text"
        :time="props.time"
        :plugins="props.plugins"
        :style="{ fontSize: props.fontSize + 'px' }"
      />
      <div v-else class="live-demo-loading">Loading...</div>
    </div>
    <div v-if="props.caption" class="live-demo-caption">{{ props.caption }}</div>
  </div>
</template>
