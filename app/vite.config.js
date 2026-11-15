import { defineConfig } from 'vite';

export default defineConfig({
  base: '/workspace/',
  build: { chunkSizeWarningLimit: 1600 },
});
