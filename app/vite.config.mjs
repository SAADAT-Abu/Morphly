import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  // The version, for the About tab and the methods sentence a graph writes.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative base so the production build loads correctly over file://
  // when Electron opens dist/index.html directly.
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  // Unit tests cover the pure modules only: geometry, table layout, colour
  // handling, SVG export and the file format. They run in Node, with no DOM,
  // no network and no access to the user's files.
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
