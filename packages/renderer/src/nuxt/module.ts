import { addComponent, defineNuxtModule } from '@nuxt/kit';

export interface ModuleOptions {
  /** Prefix prepended to the auto-imported component name. Default: `""`. */
  prefix?: string;
  /** Auto-import `<TegakiRenderer>` as a global component. Default: `true`. */
  autoImport?: boolean;
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'tegaki',
    configKey: 'tegaki',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {
    prefix: '',
    autoImport: true,
  },
  setup(options, nuxt) {
    const transpile = (nuxt.options.build.transpile ||= []);
    if (!transpile.includes('tegaki')) transpile.push('tegaki');

    if (options.autoImport !== false) {
      addComponent({
        name: `${options.prefix ?? ''}TegakiRenderer`,
        filePath: 'tegaki/vue',
        export: 'TegakiRenderer',
      });
    }
  },
});

declare module '@nuxt/schema' {
  interface NuxtConfig {
    tegaki?: ModuleOptions;
  }
}
