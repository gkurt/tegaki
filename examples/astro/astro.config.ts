import { defineConfig } from 'astro/config';
import tegaki from 'tegaki/astro/integration';

// Static output (the default), served by `astro preview`. The `tegaki/astro`
// component renders the text's DOM layer on the server and hydrates it with
// `TegakiEngine` on the client.
export default defineConfig({
  // Resolves font bundles' font URLs on the server, where tegaki/astro serializes them.
  integrations: [tegaki()],
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      conditions: ['tegaki@dev', 'browser'],
    },
    ssr: {
      resolve: {
        conditions: ['tegaki@dev'],
        externalConditions: ['tegaki@dev'],
      },
    },
  },
});
