<script lang="ts">
import bundle from 'tegaki/fonts/caveat';
import { TegakiRenderer } from 'tegaki/svelte';

let time = $state(8);
let size = $state(48);
</script>

<main class="page">
  <h1>Tegaki × Svelte</h1>
  <p>Vite + Svelte 5 app using the <code>tegaki/svelte</code> adapter.</p>

  <section id="looping">
    <h2>Looping</h2>
    <TegakiRenderer font={bundle} text="Hello, Svelte!" time={{ mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 }} style="font-size: 64px" />
  </section>

  <section id="scrubbable">
    <h2>Scrubbable</h2>
    <input type="range" min={0} max={8} step={0.01} bind:value={time} />
    <button id="resize" onclick={() => (size = size === 48 ? 72 : 48)}>Toggle size</button>
    <TegakiRenderer font={bundle} text="Scrub me!" {time} style={`font-size: ${size}px`} />
  </section>
</main>
