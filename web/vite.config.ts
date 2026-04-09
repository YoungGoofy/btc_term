import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Binance API proxy
      '/binance-fapi': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-fapi/, ''),
      },
      '/binance-ws': {
        target: 'wss://fstream.binance.com',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/binance-ws/, ''),
      },
      // Polymarket proxies
      '/gamma-api': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gamma-api/, ''),
      },
      '/clob-api': {
        target: 'https://clob.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/clob-api/, ''),
      },
      '/pm-ws': {
        target: 'wss://ws-subscriptions-clob.polymarket.com',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/pm-ws/, ''),
      },
    },
  },
});
