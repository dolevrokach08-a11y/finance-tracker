import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const htmlEntries = {
  app: resolve(process.cwd(), 'app.html'),
  login: resolve(process.cwd(), 'login.html'),
};

function filesIn(directory, prefix = directory) {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const diskPath = `${directory}/${entry.name}`;
    const outputPath = `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesIn(diskPath, outputPath) : [{ diskPath, outputPath }];
  });
}

function staticApplicationFiles() {
  const legacyPages = ['index.html', 'portfolio.html', 'finance.html', 'mortgage.html', 'tax-optimizer.html', 'terms.html'];
  const rootAssets = [
    'firebase-config.js', 'demo-data.js', 'ai-assistant.js', 'sync-widget.js', 'ticker.js',
    'terms-modal.js', 'tax-optimizer.app.js', 'finance.tailwind.css', 'shared-theme.css',
    'manifest.json', 'sw.js',
  ];
  const files = [
    ...legacyPages.map(file => ({ diskPath: file, outputPath: file })),
    ...rootAssets.map(file => ({ diskPath: file, outputPath: file })),
    ...filesIn('app'),
    ...filesIn('shared'),
    ...filesIn('vendor'),
    ...filesIn('icons'),
  ];
  return {
    name: 'static-application-files',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'server/index.js',
        source: `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname.endsWith('/index')) {
      return Response.redirect(new URL('./app.html#/home', request.url), 302);
    }
    return env.ASSETS.fetch(request);
  }
};\n`,
      });
      files.forEach(({ diskPath, outputPath }) => {
        this.emitFile({
          type: 'asset',
          fileName: outputPath,
          source: readFileSync(resolve(process.cwd(), diskPath)),
        });
      });
    },
  };
}

// Keeps your existing multi-page HTML app; no bundling step required for dev.
export default defineConfig({
  base: './',
  plugins: [staticApplicationFiles()],
  server: {
    port: 5500,
    strictPort: true,
    open: '/login.html',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: htmlEntries,
    },
  },
  // No `public/` folder in this repo — disable so Vite does not warn.
  publicDir: false,
});
