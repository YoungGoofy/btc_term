import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function logSaverPlugin(): Plugin {
  return {
    name: 'log-saver',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/api/save-log' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const { text, overwrite } = JSON.parse(body);
              const logPath = path.resolve(__dirname, '../signal_log.txt');
              if (overwrite) {
                fs.writeFileSync(logPath, text, 'utf-8');
              } else {
                fs.appendFileSync(logPath, text + '\n', 'utf-8');
              }
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), logSaverPlugin()],
  server: {
    port: 3000,
    open: true,
    proxy: {
// ... existing proxies

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
      // RL Agent training dashboard
      '/training': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws/training': {
        target: 'ws://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
