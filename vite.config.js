import { defineConfig } from 'vite';

export default defineConfig({
  base: '/conservatory-payments-site/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8888' }
  }
});