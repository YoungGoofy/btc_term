import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Лог файл будет монтироваться снаружи через docker volume
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || path.resolve(__dirname, 'signal_log.txt');

// Для обработки POST /api/save-log
app.use(express.json({ limit: '10mb' }));

app.post('/api/save-log', (req, res) => {
  try {
    const { text, overwrite } = req.body;
    if (typeof text !== 'string') {
      res.status(400).json({ error: 'Text required' });
      return;
    }
    
    if (overwrite) {
      fs.writeFileSync(LOG_FILE_PATH, text, 'utf-8');
    } else {
      fs.appendFileSync(LOG_FILE_PATH, text + '\n', 'utf-8');
    }
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('Error saving log:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Прокси для балансировки CORS в Production (эмуляция vite.config.ts)
app.use('/binance-fapi', createProxyMiddleware({
  target: 'https://fapi.binance.com',
  changeOrigin: true,
  pathRewrite: { '^/binance-fapi': '' },
}));

const binanceWsProxy = createProxyMiddleware({
  target: 'wss://fstream.binance.com',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/binance-ws': '' },
});
app.use('/binance-ws', binanceWsProxy);

app.use('/gamma-api', createProxyMiddleware({
  target: 'https://gamma-api.polymarket.com',
  changeOrigin: true,
  pathRewrite: { '^/gamma-api': '' },
}));

app.use('/clob-api', createProxyMiddleware({
  target: 'https://clob.polymarket.com',
  changeOrigin: true,
  pathRewrite: { '^/clob-api': '' },
}));

const pmWsProxy = createProxyMiddleware({
  target: 'wss://ws-subscriptions-clob.polymarket.com',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/pm-ws': '' },
});
app.use('/pm-ws', pmWsProxy);

// Раздача статики собранного React приложения
app.use(express.static(path.join(__dirname, 'dist')));

// Любой другой роут отдаем index.html (SPA Fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Production Terminal Server running on port ${PORT}`);
  console.log(`📂 Log file path configured as: ${LOG_FILE_PATH}`);
});

// VERY IMPORTANT: Express doesn't automatically upgrade websockets for middlewares.
// We must manually pass upgrade events to our proxy middleware instances.
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/binance-ws')) {
    binanceWsProxy.upgrade(req, socket, head);
  } else if (req.url.startsWith('/pm-ws')) {
    pmWsProxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});
