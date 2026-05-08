declare module '*.ttf' {
  const src: string;
  export default src;
}

declare module '*.svelte' {
  import type { Component } from 'svelte';

  const component: Component<any>;
  export default component;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
