import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/** Prevent Vite's index.html from shadowing Laravel's public/index.php (Apache/XAMPP). */
function removePublicIndexHtml() {
  return {
    name: 'remove-public-index-html',
    closeBundle() {
      const indexHtml = path.join(publicDir, 'index.html');
      if (existsSync(indexHtml)) {
        unlinkSync(indexHtml);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), removePublicIndexHtml()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Build hashed assets into Laravel's public/assets so `php artisan serve`
  // can render the SPA without a separate Vite process.
  build: {
    outDir: publicDir,
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api':      { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/storage':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/auth':     { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/billing':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/checkout': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
