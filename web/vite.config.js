import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    // One file: lazy chunks would resolve against the document <base>, which points at the user's folder.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
