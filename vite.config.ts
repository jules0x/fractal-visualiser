import { defineConfig } from 'vite';

// Relative base so the built bundle works from any GitHub Pages subpath.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
