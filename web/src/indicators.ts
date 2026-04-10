import { EMA, MACD, RSI, ATR } from 'technicalindicators';
import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from './types';

// ─── Heikin Ashi (manual) ─────────────────────

export interface HACandle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function calcHeikinAshi(candles: Candle[]): HACandle[] {
  const ha: HACandle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0
      ? (c.open + c.close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    ha.push({ time: c.time as UTCTimestamp, open: haOpen, high: haHigh, low: haLow, close: haClose });
  }
  return ha;
}

// ─── VWAP (manual) ────────────────────────────

export interface VWAPPoint {
  time: UTCTimestamp;
  value: number;
}

export interface VWAPResult {
  center: VWAPPoint[];
  upper: VWAPPoint[];
  lower: VWAPPoint[];
}

export function calcVWAP(candles: Candle[]): VWAPResult {
  let cumTPV = 0;
  let cumVol = 0;
  let cumTP2V = 0; // sum(tp^2 * volume) for variance calculation
  let currentDay = -1;

  const center: VWAPPoint[] = [];
  const upper: VWAPPoint[] = [];
  const lower: VWAPPoint[] = [];

  for (const c of candles) {
    // Reset at each new UTC day.
    const day = Math.floor(c.time / 86400);
    if (day !== currentDay) {
      cumTPV = 0;
      cumVol = 0;
      cumTP2V = 0;
      currentDay = day;
    }

    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    cumTP2V += tp * tp * c.volume;

    const vwap = cumVol > 0 ? cumTPV / cumVol : tp;
    // Variance = E[X²] - E[X]²  (volume-weighted)
    const variance = cumVol > 0 ? (cumTP2V / cumVol) - vwap * vwap : 0;
    const sd = Math.sqrt(Math.max(0, variance));

    const t = c.time as UTCTimestamp;
    center.push({ time: t, value: vwap });
    upper.push({ time: t, value: vwap + sd });
    lower.push({ time: t, value: vwap - sd });
  }

  return { center, upper, lower };
}

// ─── EMA (technicalindicators) ────────────────

export type LinePoint = { time: UTCTimestamp; value: number } | { time: UTCTimestamp };

export function calcEMA(candles: Candle[], period: number): LinePoint[] {
  const closes = candles.map((c) => c.close);
  const values = EMA.calculate({ period, values: closes });
  const offset = candles.length - values.length;
  
  const padding: LinePoint[] = Array.from({ length: offset }).map((_, i) => ({
    time: candles[i].time as UTCTimestamp,
  }));
  const data: LinePoint[] = values.map((v, i) => ({ time: candles[i + offset].time as UTCTimestamp, value: v }));
  
  return [...padding, ...data];
}

// ─── MACD (technicalindicators) ───────────────

export type MACDPoint = {
  time: UTCTimestamp;
  macd: number;
  signal: number;
  histogram: number;
} | { time: UTCTimestamp };

export function calcMACD(candles: Candle[]): MACDPoint[] {
  const closes = candles.map((c) => c.close);
  const results = MACD.calculate({
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    values: closes,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const offset = candles.length - results.length;
  
  const padding: MACDPoint[] = Array.from({ length: offset }).map((_, i) => ({
    time: candles[i].time as UTCTimestamp,
  }));
  const data: MACDPoint[] = results.map((r, i) => ({
    time: candles[i + offset].time as UTCTimestamp,
    macd: r.MACD ?? 0,
    signal: r.signal ?? 0,
    histogram: r.histogram ?? 0,
  }));

  return [...padding, ...data];
}

// ─── RSI (technicalindicators) ────────────────

export function calcRSI(candles: Candle[], period = 14): LinePoint[] {
  const closes = candles.map((c) => c.close);
  const values = RSI.calculate({ period, values: closes });
  const offset = candles.length - values.length;

  const padding: LinePoint[] = Array.from({ length: offset }).map((_, i) => ({
    time: candles[i].time as UTCTimestamp,
  }));
  const data: LinePoint[] = values.map((v, i) => ({ time: candles[i + offset].time as UTCTimestamp, value: v }));

  return [...padding, ...data];
}

// ─── ATR (technicalindicators) ────────────────

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const values = ATR.calculate({ period, high: highs, low: lows, close: closes });
  return values.length > 0 ? values[values.length - 1] : 0;
}

// ─── Pivots HL 10 (manual) ────────────────────

export function calcPivots(
  haCandles: HACandle[],
  leftBars = 10,
  rightBars = 10
): { highs: LinePoint[]; lows: LinePoint[] } {
  const highs: LinePoint[] = [];
  const lows: LinePoint[] = [];

  for (let i = leftBars; i < haCandles.length - rightBars; i++) {
    const c = haCandles[i];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = 1; j <= leftBars; j++) {
      if (haCandles[i - j].high >= c.high) isPivotHigh = false;
      if (haCandles[i - j].low <= c.low) isPivotLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (haCandles[i + j].high >= c.high) isPivotHigh = false;
      if (haCandles[i + j].low <= c.low) isPivotLow = false;
    }

    if (isPivotHigh) highs.push({ time: c.time, value: c.high });
    if (isPivotLow) lows.push({ time: c.time, value: c.low });
  }

  return { highs, lows };
}

// ─── Aggregate calculation ────────────────────

export interface ComputedData {
  ha: HACandle[];
  vwap: VWAPResult;
  ema9: LinePoint[];
  ema21: LinePoint[];
  macd: MACDPoint[];
  rsi: LinePoint[];
  atrValue: number;
  pivotHighs: LinePoint[];
  pivotLows: LinePoint[];
}

export function computeAll(candles: Candle[]): ComputedData {
  const ha = calcHeikinAshi(candles);
  const vwap = calcVWAP(candles);
  const ema9 = calcEMA(candles, 9);
  const ema21 = calcEMA(candles, 21);
  const macd = calcMACD(candles);
  const rsi = calcRSI(candles);
  const atrValue = calcATR(candles);
  const { highs: pivotHighs, lows: pivotLows } = calcPivots(ha);
  return { ha, vwap, ema9, ema21, macd, rsi, atrValue, pivotHighs, pivotLows };
}
