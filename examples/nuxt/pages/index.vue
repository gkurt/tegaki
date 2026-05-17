<script setup lang="ts">
import { ref } from 'vue';
import bundle from 'tegaki/fonts/caveat';

const time = ref(0);
</script>

<template>
  <main class="page">
    <h1>Tegaki × Nuxt</h1>
    <p>Handwriting animation rendered via the <code>tegaki/nuxt</code> module.</p>

    <section>
      <h2>Looping</h2>
      <TegakiRenderer
        :font="bundle"
        text="Hello, Nuxt!"
        :time="{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }"
        :style="{ fontSize: '64px' }"
      />
    </section>

    <section>
      <h2>Scrubbable</h2>
      <input type="range" :min="0" :max="8" :step="0.01" v-model.number="time" />
      <TegakiRenderer
        :font="bundle"
        text="Scrub me!"
        :time="time"
        :style="{ fontSize: '48px' }"
      />
    </section>

    <section>
      <h2>With effects</h2>
      <TegakiRenderer
        :font="bundle"
        text="Fancy!"
        :time="{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }"
        :effects="{ glow: { radius: 8, color: '#00ccff' }, pressureWidth: true, strokeGradient: { colors: 'rainbow' } }"
        :style="{ fontSize: '56px' }"
      />
    </section>
  </main>
</template>

<style>
.page {
  font-family: system-ui, sans-serif;
  max-width: 720px;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.5;
}
.page section {
  margin: 2rem 0;
  padding: 1.5rem;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
}
.page h2 {
  margin-top: 0;
}
.page input[type='range'] {
  width: 100%;
  margin-bottom: 1rem;
}
</style>
