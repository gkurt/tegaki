import { Config } from '@remotion/cli/config';

// Inline TTF and WASM assets as data URLs so they resolve correctly in both
// Remotion Studio and the renderer. Without this, webpack emits asset URLs
// with relative paths like `../../packages/renderer/dist/fonts/caveat/caveat.ttf`
// or `harfbuzzjs/harfbuzz.wasm` which escape the studio's served root and
// fall through to the SPA catch-all (returning index.html — wasm then errors
// with "expected magic word 00 61 73 6d, found 3c 21 44 4f").
Config.overrideWebpackConfig((config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      // harfbuzzjs ships an Emscripten-generated module that statically
      // requires Node built-ins (fs/path/crypto/module/url) inside a runtime
      // branch that's only taken under Node. Stub them out for the browser bundle.
      fallback: {
        ...config.resolve?.fallback,
        fs: false,
        path: false,
        crypto: false,
        module: false,
        url: false,
      },
    },
    module: {
      ...config.module,
      rules: [
        ...(config.module?.rules ?? []).filter((rule) => {
          if (typeof rule !== 'object' || !rule || !rule.test) return true;
          const test = rule.test;
          if (!(test instanceof RegExp)) return true;
          return !test.test('a.ttf') && !test.test('a.wasm');
        }),
        {
          test: /\.ttf$/,
          type: 'asset/inline',
        },
        {
          test: /\.wasm$/,
          type: 'asset/inline',
        },
      ],
    },
  };
});
