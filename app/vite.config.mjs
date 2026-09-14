import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
