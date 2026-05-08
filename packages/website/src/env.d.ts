/// <reference path="../.astro/types.d.ts" />

declare module '#output/*/bundle.ts' {
  import type { TegakiBundle } from 'tegaki';

  const bundle: TegakiBundle;
  export default bundle;
}
