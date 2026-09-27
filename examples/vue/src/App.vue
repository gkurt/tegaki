<script setup lang="ts">
import { ref } from 'vue';
import amiriBundle from 'tegaki/fonts/amiri';
import bundle from 'tegaki/fonts/caveat';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
import { TegakiEngine, TegakiRenderer } from 'tegaki/vue';

// Register the shaper on the engine the adapter itself uses (re-exported from
// `tegaki/vue`), so Arabic gets its joined positional forms.
TegakiEngine.registerShaper(harfbuzzShaper);

const time = ref(8);
</script>

<template>
  <main class="page">
    <h1>Tegaki × Vue</h1>
    <p>Vite + Vue 3 app using the <code>tegaki/vue</code> adapter.</p>

    <section id="looping">
      <h2>Looping</h2>
      <TegakiRenderer
        :font="bundle"
        text="Hello, Vue!"
        :time="{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }"
        :style="{ fontSize: '64px' }"
      />
    </section>

    <section id="scrubbable">
      <h2>Scrubbable</h2>
      <input v-model.number="time" type="range" min="0" max="8" step="0.01" />
      <TegakiRenderer :font="bundle" text="Scrub me!" :time="time" :style="{ fontSize: '48px' }" />
    </section>

    <section id="arabic">
      <h2>Shaper (Arabic, RTL)</h2>
      <p>Amiri through <code>tegaki/shaper-harfbuzz</code>, so the letters join in their positional forms.</p>
      <TegakiRenderer
        :font="amiriBundle"
        text="الكتابة اليدوية رائعة"
        direction="rtl"
        :time="{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }"
        :style="{ fontSize: '56px' }"
      />
    </section>
  </main>
</template>
