import path from "node:path";
import { vitePluginEditframe } from "@editframe/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [
    tailwindcss(),
    vitePluginEditframe({
      root: path.join(__dirname, "src"),
      cacheRoot: path.join(__dirname, "src", "assets"),
    }),
    viteSingleFile(),
    react(),
  ],
});
