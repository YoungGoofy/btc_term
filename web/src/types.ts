// Binance REST kline array format:
// [openTime, open, high, low, close, volume, closeTime, ...]
export type BinanceKlineRaw = [
  number, string, string, string, string, string,
  number, string, string, string, string, string
];

export interface Candle {
  time: number;   // Unix seconds (lightweight-charts format)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BinanceWSMessage {
  e: string;
  E: number;
  k: BinanceWSKline;
}

export interface BinanceWSKline {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  x: boolean; // is this kline closed?
}
