import { defineConfig } from 'vite';

// The terminal panel's page. It is a separate build (and a separate web view in the app) so the
// page that renders Markdown never contains, or can reach, the code that talks to the shell.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: { input: 'terminal.html', output: { inlineDynamicImports: true } },
  },
});
