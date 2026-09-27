import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: ['tegaki@dev', 'browser'],
  },
});
