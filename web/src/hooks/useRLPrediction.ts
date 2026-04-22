import { useState, useEffect, useCallback, useRef } from 'react';
import type { SmartVerdict } from '../smartAlg';
import type { PolymarketData } from '../polymarket';
import type { MTFRecord } from '../mtf';

const RL_API = 'http://localhost:8080';
const FETCH_INTERVAL_MS = 60_000; // every 1m candle close

export interface RLPrediction {
  action: number;       // 0=HOLD, 1=UP, 2=DOWN
  actionName: string;  // "HOLD" | "UP" | "DOWN"
  confidence: number;   // 0..1
  modelVersion: string;
}

export interface RLPredictionState {
  prediction: RLPrediction | null;
  error: string;
  lastFetch: number;
}

export function useRLPrediction(
  mtfData: MTFRecord | null,
  pmData: PolymarketData,
  interval: string,
) {
  const [rlEnabled, setRlEnabled] = useState(false);
  const [rlState, setRlState] = useState<RLPredictionState>({
    prediction: null,
    error: '',
    lastFetch: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrediction = useCallback(async () => {
    if (!rlEnabled || !mtfData || !mtfData[interval]) return;

    try {
      // Build observation payload from current indicators
      const data = mtfData[interval]!;
      const payload = buildIndicatorPayload(data, pmData);
      const encoded = btoa(JSON.stringify(payload));

      const resp = await fetch(`${RL_API}/predict?indicators=${encoded}`);
      if (!resp.ok) throw new Error(`RL API: ${resp.status}`);
      const pred: RLPrediction = await resp.json();

      setRlState({ prediction: pred, error: '', lastFetch: Date.now() });

      // Submit to feedback log for solo tracking
      fetch(`${RL_API}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          window_ts: pmData.currentWindowTs,
          action: pred.action,
          outcome: 'pending',
        }),
      }).catch(() => {});
    } catch (e) {
      setRlState(s => ({ ...s, error: String(e) }));
    }
  }, [rlEnabled, mtfData, pmData, interval]);

  // Fetch every 60 seconds when enabled
  useEffect(() => {
    if (rlEnabled) {
      fetchPrediction();
      intervalRef.current = setInterval(fetchPrediction, FETCH_INTERVAL_MS);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setRlState({ prediction: null, error: '', lastFetch: 0 });
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [rlEnabled, fetchPrediction]);

  return { rlState, rlEnabled, setRlEnabled };
}

/** Build a minimal indicator payload for the RL API.
 *  The full 246-dim observation is built server-side from raw values. */
function buildIndicatorPayload(data: any, pmData: PolymarketData): number[] {
  // Send key raw values — RL server reconstructs the full obs
  const ha = data.ha || [];
  const last = ha.length > 0 ? ha[ha.length - 1] : null;
  const rsiVal = data.rsi?.length > 0 && 'value' in data.rsi[data.rsi.length - 1]
    ? (data.rsi[data.rsi.length - 1] as any).value : 50;
  const macdHist = data.macd?.length > 0 && 'histogram' in data.macd[data.macd.length - 1]
    ? (data.macd[data.macd.length - 1] as any).histogram : 0;
  const atrVal = data.atrValue || 0;
  const vwapCenter = data.vwap?.center?.length > 0
    ? data.vwap.center[data.vwap.center.length - 1].value : last?.close || 0;
  const ema9 = data.ema9?.length > 0 && 'value' in data.ema9[data.ema9.length - 1]
    ? (data.ema9[data.ema9.length - 1] as any).value : last?.close || 0;
  const ema21 = data.ema21?.length > 0 && 'value' in data.ema21[data.ema21.length - 1]
    ? (data.ema21[data.ema21.length - 1] as any).value : last?.close || 0;

  return [
    rsiVal, macdHist, atrVal, vwapCenter, ema9, ema21,
    pmData.priceUp, pmData.priceDown, pmData.spreadUp, pmData.spreadDown,
    pmData.secsRemaining,
    last?.close || 0, last?.open || 0, last?.high || 0, last?.low || 0,
  ];
}