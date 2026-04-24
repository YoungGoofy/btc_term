import type { BinanceKlineRaw, Candle, BinanceWSMessage } from './types';

const REST_BASE = '/binance-fapi/fapi/v1';
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/binance-ws/market/ws`;

// ─── REST ─────────────────────────────────────

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 500,
  startTime?: number
): Promise<Candle[]> {
  let url = `${REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (startTime) url += `&startTime=${startTime}`;
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

export interface BinanceWsInstance {
  close: () => void;
}

export function connectWS(
  symbol: string,
  interval: string,
  onTick: (candle: Candle, isClosed: boolean) => void,
  onError?: (err: Event | string) => void
): BinanceWsInstance {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  const connect = () => {
    if (!alive) return;

    ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@kline_${interval}`);

    ws.onmessage = (event) => {
      try {
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
      } catch { /* ignore malformed */ }
    };

    ws.onerror = (e) => onError?.(e);

    ws.onclose = () => {
      // If it disconnected and we're still supposed to be alive, reconnect
      if (alive) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connect(), 3000);
      }
    };
  };

  connect();

  return {
    close: () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    }
  };
}
