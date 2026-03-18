import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  appType: 'mpa',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/sub': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        nav: resolve(__dirname, 'nav.html'),
        subscriptions: resolve(__dirname, 'subscriptions.html'),
        notes: resolve(__dirname, 'notes.html'),
        snippets: resolve(__dirname, 'snippets.html'),
        logs: resolve(__dirname, 'logs.html'),
        settings: resolve(__dirname, 'settings.html')
      }
    }
  }
});
