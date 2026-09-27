// vue-tsc resolves `.vue` imports itself; this is only the fallback for when it
// can't hook TypeScript (under Bun's runtime, as the root `bun typecheck` runs it).
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
