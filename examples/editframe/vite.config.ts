import path from 'node:path';
import { vitePluginEditframe } from '@editframe/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    tailwindcss(),
    vitePluginEditframe({
      root: path.join(import.meta.dirname, 'src'),
      cacheRoot: path.join(import.meta.dirname, 'src', 'assets'),
    }),
    viteSingleFile(),
    react(),
  ],
  // Resolve the workspace `tegaki` to its TypeScript source (same as the other
  // in-repo examples) so this demo tracks local changes without a build/publish.
  resolve: {
    conditions: ['tegaki@dev', 'browser'],
  },
});
