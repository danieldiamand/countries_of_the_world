import { defineConfig } from 'vite';

export default defineConfig({
  base: '/countries_of_the_world/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
