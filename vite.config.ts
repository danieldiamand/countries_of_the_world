import { defineConfig } from 'vite';

export default defineConfig({
  base: 'https://github.com/danieldiamand/countries_of_the_world/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
