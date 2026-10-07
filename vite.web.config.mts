import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/**
 * Browser build of the renderer. It runs the very same backend (PlannerService)
 * in-page, persisted to localStorage and fed by a simulated activity provider.
 * Used for UI development, demos and the Playwright end-to-end suite.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
});
