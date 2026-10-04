import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the build works from any GitHub Pages sub-path.
// FAMILY_DATA swaps the made-up demo family for a private data module (see scripts/seed-to-app-data.mjs).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
  resolve: { alias: { '@family-data': resolve(process.env.FAMILY_DATA ?? 'src/data/demo-family.js') } },
});
