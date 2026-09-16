# Tegaki

**Handwriting animation for any font**

Tegaki (手書き) turns any font into animated handwriting.
No manual path authoring. No native dependencies. Just pick a font.

[![npm](https://img.shields.io/npm/v/tegaki)](https://www.npmjs.com/package/tegaki)
[![license](https://img.shields.io/npm/l/tegaki)](https://github.com/gkurt/tegaki/blob/main/LICENSE)

<br clear="both" />

<p align="center">
  <img src="media/hello-world.svg" alt="Tegaki is awesome handwriting animation" width="560" />
</p>

---

## Quick Start

**1. Install**

```bash
npm install tegaki
```

**2. Use** (React example)

```tsx
import { TegakiRenderer } from 'tegaki';
import caveat from 'tegaki/fonts/caveat';

function App() {
  return (
    <TegakiRenderer font={caveat} style={{ fontSize: '48px' }}>
      Hello World
    </TegakiRenderer>
  );
}
```

That's it. The text draws itself stroke by stroke with natural timing.

## Command Line

Don't want to wire up a component? Generate an animated handwriting SVG straight from your terminal — nothing to install:

```bash
npx tegaki "Tegaki is awesome"
```

This writes a self-drawing, looping `tegaki-is-awesome.svg` — drop it into a README, a slide, or any page. Pick a font, mode, size, or color:

```bash
npx tegaki "Hello World" --font tangerine --mode once -o hello.svg
npx tegaki "ABC" --stagger 80% --size 140 --color "#222"
```

`--mode` is `loop` (repeats forever, the default), `once` (draws itself a single time), or `static` (finished artwork). Run `npx tegaki --help` for every option and `--list-fonts` for the bundled fonts. The CLI emits SVG only — for PNG, GIF, or WebM use the [interactive studio](https://gkurt.com/tegaki/studio/).

## Framework Support

Tegaki works with all major frameworks:

```tsx
import { TegakiRenderer } from 'tegaki/react';   // React
import { TegakiRenderer } from 'tegaki/svelte';  // Svelte
import { TegakiRenderer } from 'tegaki/vue';     // Vue
import { TegakiRenderer } from 'tegaki/solid';   // SolidJS
```

```astro
---
import TegakiRenderer from 'tegaki/astro';       // Astro
---
```

```ts
import { TegakiEngine } from 'tegaki/core';      // Vanilla JS
import { registerTegakiElement } from 'tegaki/wc'; // Web Components
```

## Built-in Fonts

Several handwriting fonts are bundled and ready to use:

- **Caveat** — `tegaki/fonts/caveat` _(Latin)_
- **Italianno** — `tegaki/fonts/italianno` _(Latin)_
- **Tangerine** — `tegaki/fonts/tangerine` _(Latin)_
- **Parisienne** — `tegaki/fonts/parisienne` _(Latin)_
- **Suez One** — `tegaki/fonts/suez-one` _(Hebrew + Latin)_
- **Amiri** — `tegaki/fonts/amiri` _(Arabic + Latin)_
- **Tillana** — `tegaki/fonts/tillana` _(Devanagari + Latin)_
- **Klee One** — `tegaki/fonts/klee-one` _(Japanese: kana + Kyōiku grade 1–2 kanji + Latin)_
- **Nanum Pen Script** — `tegaki/fonts/nanum-pen-script` _(Korean: Hangul syllables + jamo + Latin)_
- **Atma** — `tegaki/fonts/atma` _(Bengali + Latin)_

For other fonts, use the [interactive studio](https://gkurt.com/tegaki/studio/) to create a custom bundle.

## Documentation

Visit **[gkurt.com/tegaki](https://gkurt.com/tegaki)** for full documentation:

- [Getting Started](https://gkurt.com/tegaki/getting-started/)
- [Framework Guides](https://gkurt.com/tegaki/frameworks/react/) (React, Svelte, Vue, SolidJS, Astro, Web Components, Vanilla)
- [Generating Fonts](https://gkurt.com/tegaki/guides/generating/)
- [API Reference](https://gkurt.com/tegaki/api/renderer/)

## Integrations

- [Sli.dev](https://sli.dev/) - Create presentations using markdown. [See Tegaki integration example](https://andreas-taranetz.github.io/slidev-addon-animated-text/)
- [Remotion](https://www.remotion.dev/) - Create videos programmatically with React. [See Tegaki integration example](https://github.com/gkurt/tegaki/blob/gokhan/support-font-features/examples/remotion/src/Root.tsx)

## License

[MIT](LICENSE)


## 🌐 Web Resources & Aesthetic Symbols Index
- [SYM 1F970](https://baroque-text-decor-84.pages.dev/symbol/sym-1f970/)
- [ZODIAC CELESTIAL](https://pearl-girly-fonts-86.pages.dev/ru/zodiac-celestial/)
- [QUARTER MUSICAL NOTE](https://minimal-star-symbols-43.pages.dev/symbol/quarter-musical-note/)
- [SYM 2616](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2616/)
- [LEFT WHITE CORNER BRACKET](https://lace-heart-kaomoji-64.pages.dev/symbol/left-white-corner-bracket/)
- [SYM 26E2](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-26e2/)
- [SYM 1F62D](https://sleek-bio-symbols-40.pages.dev/symbol/sym-1f62d/)
- [SYM 1D428](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d428/)
- [SYM 2666](https://neon-futuristic-symbols-58.pages.dev/symbol/sym-2666/)
- [WARM HUG EMBRACE KAOMOJI](https://zen-unicode-hub-94.pages.dev/symbol/warm-hug-embrace-kaomoji/)
- [SYM 26A9](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-26a9/)
- [GAMING WEAPONS](https://vintage-scholar-text-15.pages.dev/ja/gaming-weapons/)
- [SYM 1F613](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1f613/)
- [FREEFIRE NAMES](https://baroque-font-vault-96.pages.dev/vi/freefire-names/)
- [SYM 26FA](https://anime-sparkle-text-22.pages.dev/symbol/sym-26fa/)
- [SYM 1D415](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d415/)
- [SYM 26CC](https://minimal-star-symbols-43.pages.dev/symbol/sym-26cc/)
- [CHEERING FIGHTING FIST KAOMOJI](https://neon-glitch-symbols-84.pages.dev/symbol/cheering-fighting-fist-kaomoji/)
- [SYM 1D416](https://kawaii-kaomoji-hub-96.pages.dev/symbol/sym-1d416/)
- [SYM 1D41D](https://anime-sparkle-text-81.pages.dev/symbol/sym-1d41d/)
- [SYM 2615](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-2615/)
- [FLORAL HEART VINE](https://monochrome-text-lab-86.pages.dev/symbol/floral-heart-vine/)
- [SYM 263A FE0F](https://anime-sparkle-text-23.pages.dev/symbol/sym-263a-fe0f/)
- [SYM 1D461](https://glitch-font-studio-46.pages.dev/symbol/sym-1d461/)
- [SYM 2611](https://monochrome-text-lab-86.pages.dev/symbol/sym-2611/)
- [ANTICLOCKWISE OPEN CIRCLE ARROW](https://angelic-bow-symbols-42.pages.dev/symbol/anticlockwise-open-circle-arrow/)
- [DOWNWARD DIAGONAL ARROW](https://mecha-text-vault-91.pages.dev/symbol/downward-diagonal-arrow/)
- [NATURE FLOWERS](https://neon-glitch-symbols-84.pages.dev/vi/nature-flowers/)
- [SYM 2731](https://zen-unicode-hub-94.pages.dev/symbol/sym-2731/)
- [SYM 1D40D](https://vintage-scholar-text-15.pages.dev/symbol/sym-1d40d/)
- [SYM 262D](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-262d/)
- [SYM 26C0](https://minimal-star-symbols-43.pages.dev/symbol/sym-26c0/)
- [STARS](https://occult-aesthetic-symbols-26.pages.dev/es/stars/)
- [SYM 1F629](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f629/)
- [SYM 268A](https://minimal-star-symbols-43.pages.dev/symbol/sym-268a/)
- [SYM 26DA](https://scholarly-vintage-symbols-48.pages.dev/symbol/sym-26da/)
- [SYM 1F631](https://anime-sparkle-text-73.pages.dev/symbol/sym-1f631/)
- [SYM 1D468](https://sleek-bio-symbols-51.pages.dev/symbol/sym-1d468/)
- [SYM 1F924](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-1f924/)
- [TIKTOK CAPTIONS](https://neon-glitch-symbols-84.pages.dev/tiktok-captions/)
- [SYM 1F638](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f638/)
- [SYM 1D494](https://coquette-aesthetic-symbols-14.pages.dev/symbol/sym-1d494/)
- [SYM 2725](https://witchy-runic-text-71.pages.dev/symbol/sym-2725/)
- [STAR OPERATOR](https://gothic-bio-fonts-86.pages.dev/symbol/star-operator/)
- [SYM 26AA](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-26aa/)
- [SYM 1F973](https://anime-sparkle-text-81.pages.dev/symbol/sym-1f973/)
- [SYM 1D434](https://monochrome-text-lab-86.pages.dev/symbol/sym-1d434/)
- [SYM 26C6](https://sleek-bio-symbols-51.pages.dev/symbol/sym-26c6/)
- [SYM 1D404](https://neon-futuristic-symbols-58.pages.dev/symbol/sym-1d404/)
- [RIGHTWARDS PAIRED HARPOON](https://sleek-bio-symbols-40.pages.dev/symbol/rightwards-paired-harpoon/)
- [SYM 2640](https://mecha-text-vault-91.pages.dev/symbol/sym-2640/)
- [SYM 26CA](https://raven-gothic-kaomoji-25.pages.dev/symbol/sym-26ca/)
- [BLACK HEART](https://mecha-text-vault-91.pages.dev/symbol/black-heart/)
- [SYM 1F607](https://gothic-bio-fonts-86.pages.dev/symbol/sym-1f607/)
- [LEFT MATHEMATICAL WHITE SQUARE BRACKET](https://soft-bow-fonts-22.pages.dev/symbol/left-mathematical-white-square-bracket/)
- [SYM 26E8](https://vintage-scholar-text-15.pages.dev/symbol/sym-26e8/)
- [SYM 2724](https://neon-futuristic-symbols-58.pages.dev/symbol/sym-2724/)
- [SYM 1F610](https://pastel-chibi-emotes-23.pages.dev/symbol/sym-1f610/)
- [LITTLE CAT PAWS KAOMOJI](https://coquette-aesthetic-symbols-86.pages.dev/symbol/little-cat-paws-kaomoji/)
- [SYM 1D48F](https://raven-gothic-kaomoji-25.pages.dev/symbol/sym-1d48f/)
- [SYM 1D47C](https://sleek-bio-symbols-51.pages.dev/symbol/sym-1d47c/)
- [SYM 1D437](https://gothic-bio-fonts-81.pages.dev/symbol/sym-1d437/)
- [SYM 2663](https://sleek-bio-symbols-51.pages.dev/symbol/sym-2663/)
- [SYM 1D473](https://raven-gothic-kaomoji-25.pages.dev/symbol/sym-1d473/)
- [SYM 2748](https://baroque-font-vault-96.pages.dev/symbol/sym-2748/)
- [MUSIC FLAT SIGN](https://kawaii-kaomoji-hub-93.pages.dev/symbol/music-flat-sign/)
- [INSTAGRAM BIO](https://angelic-bow-symbols-42.pages.dev/ru/instagram-bio/)
- [EIGHT POINTED STAR](https://neon-glitch-symbols-84.pages.dev/symbol/eight-pointed-star/)
- [CURLY RIBBON LOOP](https://lace-heart-kaomoji-64.pages.dev/symbol/curly-ribbon-loop/)
- [SYM 1F921](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1f921/)
- [SYM 1D493](https://anime-sparkle-text-81.pages.dev/symbol/sym-1d493/)
- [RINGED PLANET SATURN](https://minimal-star-symbols-87.pages.dev/symbol/ringed-planet-saturn/)
- [TRENDING](https://coquette-aesthetic-symbols-86.pages.dev/es/trending/)
- [SYM 1D44A](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d44a/)
- [SYM 1D442](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d442/)
- [SYM 2682](https://sleek-bio-symbols-51.pages.dev/symbol/sym-2682/)
- [SYM 1D482](https://gothic-bio-fonts-81.pages.dev/symbol/sym-1d482/)
- [HEARTS](https://scholarly-cross-symbols-35.pages.dev/hearts/)
- [SYM 1D432](https://gothic-bio-fonts-14.pages.dev/symbol/sym-1d432/)
- [SYM 1D405](https://gothic-bio-fonts-81.pages.dev/symbol/sym-1d405/)
- [SYM 1F495](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1f495/)
- [SCORPIO ZODIAC SCORPION](https://lace-heart-kaomoji-64.pages.dev/symbol/scorpio-zodiac-scorpion/)
- [MUSIC WEATHER](https://scholarly-cross-symbols-35.pages.dev/pt/music-weather/)
- [SYM 263F](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-263f/)
- [WHITE STAR](https://pastel-chibi-emotes-23.pages.dev/symbol/white-star/)
- [KHANDA EMBLEM](https://dark-literary-kaomoji-13.pages.dev/symbol/khanda-emblem/)
- [SYM 1F642 200D 2194 FE0F](https://neon-futuristic-symbols-58.pages.dev/symbol/sym-1f642-200d-2194-fe0f/)
- [FIRST QUARTER WAXING MOON](https://coquette-aesthetic-symbols-86.pages.dev/symbol/first-quarter-waxing-moon/)
- [SYM 1D44B](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d44b/)
- [SYM 1F913](https://monochrome-text-lab-86.pages.dev/symbol/sym-1f913/)
- [SYM 1D405](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-1d405/)
- [SYM 2632](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-2632/)
- [ZODIAC CELESTIAL](https://mecha-blade-symbols-46.pages.dev/ja/zodiac-celestial/)
- [SYM 1D424](https://vintage-library-rune-80.pages.dev/symbol/sym-1d424/)
- [SYM 2689](https://sleek-bio-symbols-51.pages.dev/symbol/sym-2689/)
- [HEAVY STAR](https://neon-glitch-symbols-84.pages.dev/symbol/heavy-star/)
- [SYM 1D472](https://theeduplaycampen.pages.dev/symbol/sym-1d472/)
- [LEFT RIGHT EXCHANGE ARROWS](https://clean-dot-aesthetic-48.pages.dev/symbol/left-right-exchange-arrows/)
- [SYM 1F923](https://anime-sparkle-text-22.pages.dev/symbol/sym-1f923/)
- [SYM 1F978](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-1f978/)
- [SYM 1D432](https://matrix-hacker-text-52.pages.dev/symbol/sym-1d432/)
- [FREEFIRE NAMES](https://angelic-bow-symbols-42.pages.dev/ru/freefire-names/)
- [SYM 1F633](https://clean-aesthetic-fonts-33.pages.dev/symbol/sym-1f633/)
- [SYM 26EA](https://pastel-chibi-emotes-23.pages.dev/symbol/sym-26ea/)
- [SYM 1D464](https://glitch-font-studio-46.pages.dev/symbol/sym-1d464/)
- [HEARTS](https://vintage-library-rune-80.pages.dev/pt/hearts/)
- [GAMING WEAPONS](https://clean-aesthetic-fonts-33.pages.dev/ja/gaming-weapons/)
- [SYM 1D486](https://matrix-hacker-text-52.pages.dev/symbol/sym-1d486/)
- [BORDERS DIVIDERS](https://anime-sparkle-text-73.pages.dev/vi/borders-dividers/)
- [SYM 1D476](https://glitch-font-studio-46.pages.dev/symbol/sym-1d476/)
- [SYM 1D496](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d496/)
- [SYM 26CE](https://coquette-symbols.pages.dev/symbol/sym-26ce/)
- [SCHOLARLY CROSS SYMBOLS 35.PAGES.DEV](https://scholarly-cross-symbols-35.pages.dev/)
- [SYM 1D404](https://zen-unicode-hub-94.pages.dev/symbol/sym-1d404/)
- [TIKTOK CAPTIONS](https://scholarly-cross-symbols-35.pages.dev/tiktok-captions/)
- [STARS](https://mecha-blade-symbols-46.pages.dev/vi/stars/)
- [KAOMOJI](https://gothic-bio-fonts-86.pages.dev/kaomoji/)
- [SYM 26CC](https://anime-sparkle-text-81.pages.dev/symbol/sym-26cc/)
- [SYM 26F3](https://gothic-bio-fonts-81.pages.dev/symbol/sym-26f3/)
- [SPARKLE DOT FLARE](https://sleek-line-symbols-51.pages.dev/symbol/sparkle-dot-flare/)
- [SYM 26C7](https://dark-literary-kaomoji-13.pages.dev/symbol/sym-26c7/)
- [SYM 1F64A](https://vintage-angel-text-38.pages.dev/symbol/sym-1f64a/)
- [SYM 1F636](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1f636/)
- [SYM 1F975](https://modern-bullet-symbols-45.pages.dev/symbol/sym-1f975/)
- [GREEK PSI TRIDENT](https://mecha-gamer-fonts-53.pages.dev/symbol/greek-psi-trident/)
- [DISCORD STATUS](https://glitch-mecha-kaomoji-69.pages.dev/pt/discord-status/)
- [FREEFIRE NAMES](https://scholarly-cross-symbols-35.pages.dev/freefire-names/)
- [SYM 2672](https://cyber-clan-tags-36.pages.dev/symbol/sym-2672/)
- [SYM 2742](https://cyber-clan-tags-36.pages.dev/symbol/sym-2742/)
- [HEAVY RIGHTWARD ARROW](https://gothic-bio-fonts-14.pages.dev/symbol/heavy-rightward-arrow/)
