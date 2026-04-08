import type { BinanceKlineRaw, Candle, BinanceWSMessage } from './types';

const REST_BASE = 'https://fapi.binance.com/fapi/v1';
const WS_BASE = 'wss://fstream.binance.com/ws';

// ─── REST ─────────────────────────────────────

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 500
): Promise<Candle[]> {
  const url = `${REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`REST ${res.status}: ${res.statusText}`);
  const raw: BinanceKlineRaw[] = await res.json();
  return raw.map(parseRestKline);
}

function parseRestKline(k: BinanceKlineRaw): Candle {
  return {
    time: Math.floor(k[0] / 1000), // ms → seconds for lightweight-charts
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  };
}

// ─── WebSocket ────────────────────────────────

export function connectWS(
  symbol: string,
  interval: string,
  onTick: (candle: Candle, isClosed: boolean) => void,
  onError?: (err: Event) => void
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@kline_${interval}`);

  ws.onmessage = (event) => {
    const msg: BinanceWSMessage = JSON.parse(event.data);
    if (msg.e !== 'kline') return;
    const k = msg.k;
    const candle: Candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    };
    onTick(candle, k.x);
  };

  ws.onerror = (e) => onError?.(e);

  return ws;
}
