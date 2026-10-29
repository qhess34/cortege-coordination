/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cssModuleScripts } from './css-module-scripts';

export default defineConfig({
  plugins: [react(), cssModuleScripts(['@panoramax/web-viewer'])],
  // Le viewer Panoramax doit passer par le plugin ci-dessus, y compris en développement.
  optimizeDeps: { exclude: ['@panoramax/web-viewer'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  worker: { format: 'es' },
  test: { environment: 'jsdom' },
});
