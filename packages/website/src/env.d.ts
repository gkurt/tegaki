/// <reference path="../.astro/types.d.ts" />

// A shipped bundle cut down to the home page's characters (home-fonts.ts).
declare module 'tegaki-home-font:*' {
  import type { TegakiBundle } from 'tegaki';

  const bundle: TegakiBundle;
  export default bundle;
}

declare module '#output/*/bundle.ts' {
  import type { TegakiBundle } from 'tegaki';

  const bundle: TegakiBundle;
  export default bundle;
}
