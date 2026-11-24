import { defineConfig } from 'vite';

export default defineConfig({
  // Absolute app scheme so lazy chunks always resolve against the app bundle,
  // even after main.js rewrites <base href="mdv://doc/..."> for document images.
  base: 'mdv://app/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mermaid') || id.includes('node_modules/d3') || id.includes('node_modules/cytoscape') || id.includes('node_modules/dagre')) {
            return 'mermaid';
          }
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/codemirror') || id.includes('node_modules/@replit/codemirror-vim') || id.includes('node_modules/@lezer')) {
            return 'editor';
          }
        },
      },
    },
  },
});
