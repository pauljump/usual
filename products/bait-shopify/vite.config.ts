import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  server: { host: '127.0.0.1', port: 3087, allowedHosts: process.env.SHOPIFY_APP_URL ? [new URL(process.env.SHOPIFY_APP_URL).hostname] : [] },
  build: { assetsInlineLimit: 0 },
});
