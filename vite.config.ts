// vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        main:  resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
      },
    },
  },
  server: { port: 5173 },
});
