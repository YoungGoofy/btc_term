import type { MTFRecord } from './mtf';
import type { PolymarketData } from './polymarket';
import type { ComputedData, StochRSIPoint, BBPoint, MACDPoint, LinePoint, HACandle } from './indicators';

export type VerdictAction = 'ВХОД UP' | 'ВХОД DOWN' | 'ЖДАТЬ' | 'ПРОПУСТИТЬ' | 'ОЖИДАЙТЕ';

export interface FactorWeight {
  text: string;
  color: string;
  weight: number;
  rawValue?: number;
}

export interface CoreVotes {
  rsi: number;
  macd: number;
  vwap: number;
  ema: number;
  pivots: number;
}

export interface SmartVerdict {
  action: VerdictAction;
  totalWeight: number;
  maxPossibleWeight: number;
  confidence: number;
  direction: 'UP' | 'DOWN' | 'NONE';
  sizePerc: number;
  atrMode: string;
  mtfWeight: number;
  mtfStatus: { '1m': string, '5m': string, '15m': string, '4h': string };
  coreVotes: CoreVotes;
  voteCounts: { up: number; down: number; neutral: number };
  factors: {
    rsi: FactorWeight;
    macd: FactorWeight;
    macdCrossover: FactorWeight;
    vwap: FactorWeight;
    ema: FactorWeight;
    pivots: FactorWeight;
    stoch: FactorWeight;
    bb: FactorWeight;
    atr: FactorWeight;
    pm: FactorWeight;
    ha: FactorWeight;
    threeCandle: FactorWeight;
    conflicts: string[];
  };
}

// ────── Macro Stops ──────

function checkMacroStops(now: Date): string | null {
  const etHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric' }), 10);
  const m = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, minute: 'numeric' }), 10);
  const day = now.getDay();
  const date = now.getDate();

  if (etHour >= 16 && etHour < 20) return "Отдых (Тихоокеанская сессия)";
  if (day === 0 && etHour >= 21 && etHour <= 23) return "Закрытие недели (Низкая ликвидность)";

  if (day >= 2 && day <= 5) {
    const timeVal = etHour * 60 + m;
    if (timeVal >= 8 * 60 + 15 && timeVal <= 10 * 60 + 30 && date <= 10) {
      return "Макро-стоп: Окно новостей CPI/NFP (08:15-10:30)";
    }
  }

  return null;
}

// ────── ATR (timeframe-adaptive zones) ──────

function getATRScale(interval: string): number {
  switch (interval) {
    case '1m': return 1;
    case '5m': return Math.sqrt(5);
    case '15m': return Math.sqrt(15);
    case '4h': return Math.sqrt(240);
    default: return 1;
  }
}

function getAtrConfig(atr: number, interval: string) {
  const scale = getATRScale(interval);
  const normalized = atr / scale;
  const t = [30, 60, 100, 120].map(v => v * scale);

  if (atr < t[0]) return { mode: `Мертвый (<${t[0].toFixed(0)})`, multiplier: 0.5, limit: true, normalizedATR: normalized };
  if (atr < t[1]) return { mode: `Умеренный (${t[0].toFixed(0)}-${t[1].toFixed(0)})`, multiplier: 0.8, limit: false, normalizedATR: normalized };
  if (atr < t[2]) return { mode: `Золотая (${t[1].toFixed(0)}-${t[2].toFixed(0)})`, multiplier: 1.0, limit: false, normalizedATR: normalized };
  if (atr < t[3]) return { mode: `Высокий (${t[2].toFixed(0)}-${t[3].toFixed(0)})`, multiplier: 0.9, limit: true, normalizedATR: normalized };
  return { mode: `Экстрем (>${t[3].toFixed(0)})`, multiplier: 0.6, limit: true, normalizedATR: normalized };
}

// ────── Individual Weight Functions ──────

const VOTE_THRESHOLD = 0.08;

function rsiWeight(rsi: number): number {
  if (rsi <= 20) return 1.0;
  if (rsi >= 80) return -1.0;
  if (rsi <= 30) return 0.5 + 0.5 * ((30 - rsi) / 10);
  if (rsi >= 70) return -(0.5 + 0.5 * ((rsi - 70) / 10));
  if (rsi >= 47 && rsi <= 53) return 0;
  if (rsi < 47) return 0.5 * ((47 - rsi) / 17);
  return -0.5 * ((rsi - 53) / 17);
}

function macdHistWeight(histogram: number, atr: number): number {
  const normalizer = Math.max(atr * 0.3, 5);
  const normalized = histogram / normalizer;
  return Math.max(-0.8, Math.min(0.8, normalized * 0.5));
}

function macdCrossoverWeight(macdPoints: MACDPoint[], lookback: number = 3): number {
  if (macdPoints.length < lookback + 1) return 0;
  for (let i = 0; i < lookback; i++) {
    const pPrev = macdPoints[macdPoints.length - 2 - i];
    const pCurr = macdPoints[macdPoints.length - 1 - i];
    if ('macd' in pPrev && 'macd' in pCurr) {
      if (pPrev.macd <= pPrev.signal && pCurr.macd > pCurr.signal) return 0.6 * (1 - i * 0.2);
      if (pPrev.macd >= pPrev.signal && pCurr.macd < pCurr.signal) return -0.6 * (1 - i * 0.2);
    }
  }
  return 0;
}

function vwapWeight(price: number, vwap: number, atr: number): number {
  const distance = (price - vwap) / Math.max(atr * 0.5, 10);
  return Math.max(-0.5, Math.min(0.5, distance * 0.35));
}

function emaWeight(ema9: number, ema21: number, atr: number): number {
  const spread = (ema9 - ema21) / Math.max(atr * 0.5, 10);
  return Math.max(-0.6, Math.min(0.6, spread * 0.4));
}

function pivotsWeight(price: number, lastHigh: number, lastLow: number): number {
  if (price > lastHigh) return 0.5;
  if (price < lastLow) return -0.5;
  const range = lastHigh - lastLow;
  if (range <= 0) return 0;
  const position = (price - lastLow) / range;
  return (position - 0.5) * 0.6;
}

function stochWeight(stochRSI: number, direction: 'UP' | 'DOWN' | 'NONE'): number {
  if (direction === 'UP' && stochRSI > 80) return -(0.2 + 0.2 * ((stochRSI - 80) / 20));
  if (direction === 'DOWN' && stochRSI < 20) return -(0.2 + 0.2 * ((20 - stochRSI) / 20));
  if (direction === 'UP' && stochRSI < 20) return 0.3;
  if (direction === 'DOWN' && stochRSI > 80) return 0.3;
  if (direction === 'UP' && stochRSI < 40) return 0.1;
  if (direction === 'DOWN' && stochRSI > 60) return 0.1;
  return 0;
}

function bbWeight(price: number, upper: number, lower: number, direction: 'UP' | 'DOWN' | 'NONE'): number {
  if (upper <= 0 || lower <= 0) return 0;
  if (price > upper) return direction === 'UP' ? 0.4 : -0.2;
  if (price < lower) return direction === 'DOWN' ? 0.4 : -0.2;
  const bandwidth = (upper - lower) / ((upper + lower) / 2);
  if (bandwidth < 0.003) return 0.1;
  const mid = (upper + lower) / 2;
  const halfBand = (upper - lower) / 2;
  if (halfBand > 0) return ((price - mid) / halfBand) * 0.15;
  return 0;
}

function haWeight(ha: HACandle[]): number {
  if (ha.length < 3) return 0;
  const last = ha[ha.length - 1];
  const prev = ha[ha.length - 2];
  const prev2 = ha[ha.length - 3];
  const isUp = (c: HACandle) => c.close > c.open;
  const bodyRatio = (c: HACandle) => Math.abs(c.close - c.open) / Math.max(c.high - c.low, 0.01);
  const noLowerShadow = (c: HACandle) => Math.abs(c.open - c.low) / c.open < 0.0005;
  const noUpperShadow = (c: HACandle) => Math.abs(c.open - c.high) / c.open < 0.0005;

  let weight = 0;
  if (isUp(last) && isUp(prev) && isUp(prev2)) weight = 0.4;
  else if (!isUp(last) && !isUp(prev) && !isUp(prev2)) weight = -0.4;
  else if (isUp(last) && isUp(prev)) weight = 0.2;
  else if (!isUp(last) && !isUp(prev)) weight = -0.2;

  if (isUp(last) && noLowerShadow(last) && bodyRatio(last) > 0.6) weight += 0.2;
  if (!isUp(last) && noUpperShadow(last) && bodyRatio(last) > 0.6) weight -= 0.2;

  return Math.max(-0.6, Math.min(0.6, weight));
}

function threeCandleWeight(ha: HACandle[]): number {
  if (ha.length < 3) return 0;
  const c1 = ha[ha.length - 3], c2 = ha[ha.length - 2], c3 = ha[ha.length - 1];
  const isGreen = (c: HACandle) => c.close > c.open;
  const bodyPerc = (c: HACandle) => Math.abs(c.close - c.open) / Math.max(c.high - c.low, 0.01);

  if (isGreen(c1) && isGreen(c2) && isGreen(c3) &&
    c3.close > c2.close && c2.close > c1.close &&
    bodyPerc(c1) > 0.4 && bodyPerc(c2) > 0.4 && bodyPerc(c3) > 0.4) return 0.5;

  if (!isGreen(c1) && !isGreen(c2) && !isGreen(c3) &&
    c3.close < c2.close && c2.close < c1.close &&
    bodyPerc(c1) > 0.4 && bodyPerc(c2) > 0.4 && bodyPerc(c3) > 0.4) return -0.5;

  return 0;
}

function mtfWeight(mtf: MTFRecord, currentInterval: string): { weight: number, statuses: Record<string, string> } {
  const weights: Record<string, number> = { '1m': 0.15, '5m': 0.25, '15m': 0.35, '4h': 0.25 };
  let total = 0;
  const statuses: Record<string, string> = { '1m': '⚪', '5m': '⚪', '15m': '⚪', '4h': '⚪' };

  for (const tf of ['1m', '5m', '15m', '4h']) {
    const data = mtf[tf];
    if (!data || data.ha.length === 0) continue;
    const rsiArr = data.rsi;
    const macdArr = data.macd;
    const rNow = rsiArr.length > 0 && 'value' in rsiArr[rsiArr.length - 1] ? (rsiArr[rsiArr.length - 1] as any).value : 50;
    const mNow = macdArr.length > 0 && 'histogram' in macdArr[macdArr.length - 1] ? (macdArr[macdArr.length - 1] as any).histogram : 0;

    let tfSignal = rsiWeight(rNow) * 0.6 + (mNow > 0 ? 0.4 : mNow < 0 ? -0.4 : 0);
    tfSignal = Math.max(-1, Math.min(1, tfSignal));
    total += tfSignal * weights[tf];
    statuses[tf] = tfSignal > 0.2 ? '🟢' : tfSignal < -0.2 ? '🔴' : '⚪';
  }
  return { weight: Math.max(-1, Math.min(1, total)), statuses };
}

// ────── RSI Divergence ──────

function rsiDivergenceWeight(ha: HACandle[], rsiArr: LinePoint[]): number {
  if (ha.length < 20 || rsiArr.length < 20) return 0;
  const lookback = 15;
  const end = ha.length - 1;
  const start = Math.max(0, end - lookback);
  const mid = Math.floor((start + end) / 2);

  let firstMaxP = -Infinity, secondMaxP = -Infinity;
  let firstMinP = Infinity, secondMinP = Infinity;
  let firstMaxR = -Infinity, secondMaxR = -Infinity;
  let firstMinR = Infinity, secondMinR = Infinity;

  for (let i = start; i <= end; i++) {
    const p = ha[i].close;
    const rVal = i < rsiArr.length && 'value' in rsiArr[i] ? (rsiArr[i] as any).value : 50;
    if (i <= mid) {
      if (p > firstMaxP) firstMaxP = p;
      if (p < firstMinP) firstMinP = p;
      if (rVal > firstMaxR) firstMaxR = rVal;
      if (rVal < firstMinR) firstMinR = rVal;
    } else {
      if (p > secondMaxP) secondMaxP = p;
      if (p < secondMinP) secondMinP = p;
      if (rVal > secondMaxR) secondMaxR = rVal;
      if (rVal < secondMinR) secondMinR = rVal;
    }
  }

  // Bearish: price higher high + RSI lower high
  if (secondMaxP > firstMaxP && secondMaxR < firstMaxR - 3) return -0.2;
  // Bullish: price lower low + RSI higher low
  if (secondMinP < firstMinP && secondMinR > firstMinR + 3) return 0.2;
  return 0;
}

function atrZoneWeight(normalizedATR: number): number {
  if (normalizedATR >= 60 && normalizedATR <= 100) return 0.2;
  if (normalizedATR >= 30 && normalizedATR < 60) return 0.0;
  if (normalizedATR > 100 && normalizedATR <= 120) return -0.1;
  if (normalizedATR > 120) return -0.2;
  return -0.3;
}

// ────── Helpers ──────

function getFactorColor(weight: number): string {
  if (weight >= 0.2) return '#26A69A';
  if (weight <= -0.2) return '#EF5350';
  return '#9E9E9E';
}

function dirColor(weight: number, dir: 'UP' | 'DOWN' | 'NONE'): string {
  return getFactorColor(dir === 'DOWN' ? -weight : weight);
}

function voteIcon(vote: number): string {
  return vote > 0 ? '▲' : vote < 0 ? '▼' : '—';
}

// ────── Main Computation ──────

export function computePrediction(mtf: MTFRecord, pmData: PolymarketData, currentInterval: string): SmartVerdict {
  const dBase = mtf[currentInterval];

  const defaultFactors = {
    rsi: { text: "—", color: "gray", weight: 0 },
    macd: { text: "—", color: "gray", weight: 0 },
    macdCrossover: { text: "—", color: "gray", weight: 0 },
    vwap: { text: "—", color: "gray", weight: 0 },
    ema: { text: "—", color: "gray", weight: 0 },
    pivots: { text: "—", color: "gray", weight: 0 },
    stoch: { text: "—", color: "gray", weight: 0 },
    bb: { text: "—", color: "gray", weight: 0 },
    atr: { text: "—", color: "gray", weight: 0 },
    pm: { text: "—", color: "gray", weight: 0 },
    ha: { text: "—", color: "gray", weight: 0 },
    threeCandle: { text: "—", color: "gray", weight: 0 },
    conflicts: [] as string[],
  };

  const v: SmartVerdict = {
    action: 'ЖДАТЬ', totalWeight: 0, maxPossibleWeight: 1.0, confidence: 0,
    direction: 'NONE', sizePerc: 0, atrMode: 'Ожидание',
    mtfWeight: 0, mtfStatus: { '1m': '⚪', '5m': '⚪', '15m': '⚪', '4h': '⚪' },
    coreVotes: { rsi: 0, macd: 0, vwap: 0, ema: 0, pivots: 0 },
    voteCounts: { up: 0, down: 0, neutral: 0 },
    factors: defaultFactors,
  };

  if (!dBase || dBase.ha.length === 0) return v;

  // 1. Macro stops
  const now = new Date();
  const macroStop = checkMacroStops(now);
  if (macroStop) { v.action = 'ПРОПУСТИТЬ'; v.factors.conflicts.push(macroStop); return v; }

  // 2. ATR config (timeframe-adaptive)
  const atrVal = dBase.atrValue;
  const atrCfg = getAtrConfig(atrVal, currentInterval);
  v.atrMode = atrCfg.mode;

  if (atrCfg.normalizedATR < 30) v.factors.conflicts.push('Внимание: низкая волатильность');

  // 3. PM time constraints — warmup period after window change
  const WARMUP_SECS = 600; // 10 минут (15m - 10m = 5m сбор данных)
  if (pmData.currentWindowTs === 0 || pmData.secsRemaining === 0) {
    // PM data not loaded yet — don't give signals
    v.action = 'ОЖИДАЙТЕ';
    v.factors.conflicts.push('Ожидание данных Polymarket');
  } else if (pmData.secsRemaining > WARMUP_SECS) {
    const waitMins = Math.ceil((pmData.secsRemaining - WARMUP_SECS) / 60);
    v.action = 'ОЖИДАЙТЕ';
    v.factors.conflicts.push(`Сбор данных: жди ~${waitMins} мин`);
  } else if (pmData.secsRemaining < 300 && pmData.secsRemaining > 0) {
    v.action = 'ПРОПУСТИТЬ'; v.factors.conflicts.push('Поздно для входа (< 5m)'); return v;
  }

  // 4. Extract values
  const currentPrice = dBase.ha[dBase.ha.length - 1].close;
  const rsi15 = dBase.rsi.length > 0 && 'value' in dBase.rsi[dBase.rsi.length - 1] ? (dBase.rsi[dBase.rsi.length - 1] as any).value : 50;
  const macd15 = dBase.macd.length > 0 && 'histogram' in dBase.macd[dBase.macd.length - 1] ? (dBase.macd[dBase.macd.length - 1] as any).histogram : 0;
  const vwap15 = dBase.vwap.center.length > 0 ? dBase.vwap.center[dBase.vwap.center.length - 1].value : currentPrice;
  const ema9 = dBase.ema9.length > 0 && 'value' in dBase.ema9[dBase.ema9.length - 1] ? (dBase.ema9[dBase.ema9.length - 1] as any).value : currentPrice;
  const ema21 = dBase.ema21.length > 0 && 'value' in dBase.ema21[dBase.ema21.length - 1] ? (dBase.ema21[dBase.ema21.length - 1] as any).value : currentPrice;
  const lastLow = dBase.pivotLows.length > 0 && 'value' in dBase.pivotLows[dBase.pivotLows.length - 1] ? (dBase.pivotLows[dBase.pivotLows.length - 1] as any).value : currentPrice - 100;
  const lastHigh = dBase.pivotHighs.length > 0 && 'value' in dBase.pivotHighs[dBase.pivotHighs.length - 1] ? (dBase.pivotHighs[dBase.pivotHighs.length - 1] as any).value : currentPrice + 100;
  const stochArr = dBase.stochRSI;
  const stochVal = stochArr.length > 0 && 'stochRSI' in stochArr[stochArr.length - 1] ? (stochArr[stochArr.length - 1] as any).stochRSI : 50;
  const stochNow = stochVal <= 1 ? stochVal * 100 : stochVal;
  const bbNow = dBase.bb.length > 0 && 'upper' in dBase.bb[dBase.bb.length - 1] ? (dBase.bb[dBase.bb.length - 1] as any) : { upper: 0, middle: 0, lower: 0 };

  // 5. Compute weights (ATR-based normalizers)
  const wRsi = rsiWeight(rsi15);
  const wMacdHist = macdHistWeight(macd15, atrVal);
  const wMacdCross = macdCrossoverWeight(dBase.macd);
  const wVwap = vwapWeight(currentPrice, vwap15, atrVal);
  const wEma = emaWeight(ema9, ema21, atrVal);
  const wPivots = pivotsWeight(currentPrice, lastHigh, lastLow);
  const wHa = haWeight(dBase.ha);
  const wThreeCandle = threeCandleWeight(dBase.ha);
  const wRsiDiv = rsiDivergenceWeight(dBase.ha, dBase.rsi);
  const wAtrZone = atrZoneWeight(atrCfg.normalizedATR);
  const { weight: wMtf, statuses: mtfStatuses } = mtfWeight(mtf, currentInterval);
  v.mtfWeight = wMtf;
  v.mtfStatus = mtfStatuses as any;

  // 6. VOTING: 5 core indicators
  const wMacdCombined = Math.max(-0.8, Math.min(0.8, wMacdHist + wMacdCross * 0.5));
  const votes: CoreVotes = {
    rsi: wRsi > VOTE_THRESHOLD ? 1 : wRsi < -VOTE_THRESHOLD ? -1 : 0,
    macd: wMacdCombined > VOTE_THRESHOLD ? 1 : wMacdCombined < -VOTE_THRESHOLD ? -1 : 0,
    vwap: wVwap > 0.08 ? 1 : wVwap < -0.08 ? -1 : 0,
    ema: wEma > 0.08 ? 1 : wEma < -0.08 ? -1 : 0,
    pivots: wPivots > 0.05 ? 1 : wPivots < -0.05 ? -1 : 0,
  };

  const upVotes = Object.values(votes).filter(x => x > 0).length;
  const downVotes = Object.values(votes).filter(x => x < 0).length;
  const neutralVotes = 5 - upVotes - downVotes;
  v.coreVotes = votes;
  v.voteCounts = { up: upVotes, down: downVotes, neutral: neutralVotes };

  // 6b. SIDEWAYS DETECTOR: ATR < 50 + BB squeeze + RSI neutral + no HA trend
  const isBBSqueeze = bbNow.upper > 0 && bbNow.lower > 0 && 
    ((bbNow.upper - bbNow.lower) / ((bbNow.upper + bbNow.lower) / 2)) < 0.004;
  const isRSINeutral = rsi15 >= 42 && rsi15 <= 58;
  const isHAIndecisive = Math.abs(wHa) < 0.15;
  const isLowATR = atrCfg.normalizedATR < 50;
  
  const sidewaysScore = (isBBSqueeze ? 1 : 0) + (isRSINeutral ? 1 : 0) + (isHAIndecisive ? 1 : 0) + (isLowATR ? 1 : 0);
  
  if (sidewaysScore >= 3) {
    v.action = 'ПРОПУСТИТЬ';
    v.factors.conflicts.push(`Боковик: ${sidewaysScore}/4 признаков (${isBBSqueeze ? 'BB squeeze' : ''}${isRSINeutral ? ' RSIнейтр' : ''}${isHAIndecisive ? ' HAслаб' : ''}${isLowATR ? ' ATRнизк' : ''})`);
    // Still compute direction for display, but don't allow entry
  }

  let direction: 'UP' | 'DOWN' | 'NONE' = 'NONE';
  if (upVotes >= 3 && upVotes > downVotes) direction = 'UP';
  else if (downVotes >= 3 && downVotes > upVotes) direction = 'DOWN';

  // 6c. MOMENTUM REVERSAL DETECTOR
  // Fast indicators (HA, 3-candle, MACD crossover, RSI direction) detect reversals before slow ones (VWAP, EMA).
  // If 2+ momentum indicators strongly disagree with core vote direction → reversal in progress.
  const rsiMomentumUp = rsi15 > 55 ? 1 : 0;
  const rsiMomentumDown = rsi15 < 45 ? 1 : 0;
  const momentumUp = (wHa > 0.3 ? 1 : 0) + (wThreeCandle > 0.3 ? 1 : 0) + (wMacdCross > 0.3 ? 1 : 0) + rsiMomentumUp;
  const momentumDown = (wHa < -0.3 ? 1 : 0) + (wThreeCandle < -0.3 ? 1 : 0) + (wMacdCross < -0.3 ? 1 : 0) + rsiMomentumDown;

  if (direction === 'DOWN' && momentumUp >= 2) {
    direction = 'NONE';
    v.factors.conflicts.push(`Разворот: ${momentumUp}/4 momentum за UP (HA/3C/Cross/RSI)`);
  } else if (direction === 'UP' && momentumDown >= 2) {
    direction = 'NONE';
    v.factors.conflicts.push(`Разворот: ${momentumDown}/4 momentum за DOWN (HA/3C/Cross/RSI)`);
  }
  
  // If no core direction but 3+ momentum indicators agree → trust momentum
  if (direction === 'NONE' && momentumUp >= 3) {
    direction = 'UP';
    v.factors.conflicts.push(`Momentum override: ${momentumUp}/4 за UP`);
  } else if (direction === 'NONE' && momentumDown >= 3) {
    direction = 'DOWN';
    v.factors.conflicts.push(`Momentum override: ${momentumDown}/4 за DOWN`);
  }
  
  v.direction = direction;

  // 7. Direction-dependent weights
  const wStoch = stochWeight(stochNow, direction);
  const wBb = bbWeight(currentPrice, bbNow.upper, bbNow.lower, direction);

  // 8. CONFIDENCE: base from votes + bonuses from auxiliaries
  const majorityVotes = Math.max(upVotes, downVotes);
  // Dampen confidence when many neutrals: 3/5 with 2 neutral is weaker than 4/5 with 1 against
  const neutralPenalty = neutralVotes * 0.04;
  const baseConf = direction !== 'NONE' ? (majorityVotes / 5) - neutralPenalty : 0;

  let bonus = 0;
  if (direction === 'UP' && wHa > 0) bonus += Math.min(0.12, wHa * 0.2);
  if (direction === 'DOWN' && wHa < 0) bonus += Math.min(0.12, Math.abs(wHa) * 0.2);
  if (direction === 'UP' && wThreeCandle > 0) bonus += 0.10;
  if (direction === 'DOWN' && wThreeCandle < 0) bonus += 0.10;
  if (direction === 'UP' && wMtf > 0) bonus += Math.min(0.08, wMtf * 0.08);
  if (direction === 'DOWN' && wMtf < 0) bonus += Math.min(0.08, Math.abs(wMtf) * 0.08);
  if (wStoch > 0) bonus += wStoch * 0.05;
  if (direction !== 'NONE') bonus += Math.max(0, (direction === 'UP' ? wBb : -wBb) * 0.05);
  bonus += Math.max(0, wAtrZone * 0.05);
  if (direction === 'UP' && wRsiDiv > 0) bonus += 0.05;
  if (direction === 'DOWN' && wRsiDiv < 0) bonus += 0.05;
  if (direction === 'UP' && wRsiDiv < 0) bonus -= 0.08;
  if (direction === 'DOWN' && wRsiDiv > 0) bonus -= 0.08;

  let confidence = baseConf + bonus;

  // 9. Penalties
  // RSI direction: above 55 = bullish, below 45 = bearish (NOT the reversal weight)
  // MACD direction: histogram sign
  const rsiDir = rsi15 > 55 ? 1 : rsi15 < 45 ? -1 : 0;
  const macdDir = macd15 > 0 ? 1 : macd15 < 0 ? -1 : 0;
  if (rsiDir !== 0 && macdDir !== 0 && rsiDir !== macdDir) {
    v.factors.conflicts.push('Конфликт RSI и MACD (расхождение)');
    confidence -= 0.05;
  }

  // PM constraint — only when live
  let wPm = 0;
  if (pmData.status === 'live' && direction !== 'NONE') {
    const pmPrice = direction === 'UP' ? pmData.priceUp : pmData.priceDown;
    if (pmPrice >= 0.20 && pmPrice <= 0.70) {
      v.factors.pm = { text: `Ок (${(pmPrice * 100).toFixed(0)}¢)`, color: '#26A69A', weight: 0 };
    } else if (pmPrice > 0) {
      wPm = -0.03;
      confidence += wPm;
      v.factors.conflicts.push(`PM Цена вне зоны: ${(pmPrice * 100).toFixed(0)}¢`);
      v.factors.pm = { text: `Вне зоны (${(pmPrice * 100).toFixed(0)}¢)`, color: '#EF5350', weight: wPm };
    }
  } else if (pmData.status !== 'live') {
    v.factors.pm = { text: 'Ожидание маркета', color: '#9E9E9E', weight: 0 };
  }

  if (direction !== 'NONE' && wStoch < 0) confidence += wStoch * 0.05;

  confidence = Math.max(0, Math.min(1, confidence));
  v.confidence = confidence;
  v.totalWeight = confidence;
  v.maxPossibleWeight = 1.0;

  // 10. Factor display
  v.factors.rsi = { text: `${rsi15.toFixed(1)} [${voteIcon(votes.rsi)} ${wRsi.toFixed(2)}]`, color: dirColor(wRsi, direction), weight: wRsi, rawValue: rsi15 };
  v.factors.macd = { text: `Hist [${voteIcon(votes.macd)} ${wMacdHist.toFixed(2)}]`, color: dirColor(wMacdHist, direction), weight: wMacdHist, rawValue: macd15 };
  v.factors.macdCrossover = { text: `Cross [${wMacdCross.toFixed(2)}]`, color: dirColor(wMacdCross, direction), weight: wMacdCross };
  v.factors.vwap = { text: `Dist [${voteIcon(votes.vwap)} ${wVwap.toFixed(2)}]`, color: dirColor(wVwap, direction), weight: wVwap };
  v.factors.ema = { text: `Spread [${voteIcon(votes.ema)} ${wEma.toFixed(2)}]`, color: dirColor(wEma, direction), weight: wEma };
  v.factors.pivots = { text: `Pos [${voteIcon(votes.pivots)} ${wPivots.toFixed(2)}]`, color: dirColor(wPivots, direction), weight: wPivots };
  v.factors.stoch = { text: `${stochNow.toFixed(0)} [${wStoch.toFixed(2)}]`, color: wStoch > 0 ? '#26A69A' : wStoch < 0 ? '#EF5350' : '#9E9E9E', weight: wStoch, rawValue: stochNow };
  v.factors.bb = { text: `Band [${wBb.toFixed(2)}]`, color: wBb > 0 ? '#26A69A' : wBb < 0 ? '#EF5350' : '#9E9E9E', weight: wBb };
  v.factors.ha = { text: `HA [${wHa.toFixed(2)}]`, color: dirColor(wHa, direction), weight: wHa };
  v.factors.threeCandle = { text: `3Candle [${wThreeCandle.toFixed(2)}]`, color: dirColor(wThreeCandle, direction), weight: wThreeCandle };
  v.factors.atr = { text: `${atrCfg.mode} ($${atrVal.toFixed(0)}) [${wAtrZone.toFixed(2)}]`, color: atrCfg.limit ? '#EF5350' : '#26A69A', weight: wAtrZone };

  // 11. Final decision
  const ENTRY_THRESHOLD = 0.35;
  if (v.action !== 'ПРОПУСТИТЬ' && v.action !== 'ОЖИДАЙТЕ') {
    if (direction !== 'NONE' && confidence >= ENTRY_THRESHOLD) {
      // Check if PM price already shows the move happened (>70¢ or <20¢)
      const pmPrice = direction === 'UP' ? pmData.priceUp : pmData.priceDown;
      if (pmData.status === 'live' && pmPrice > 0.70) {
        // Price already moved in our direction — too late (conflict text already added in section 9)
        v.action = pmData.secsRemaining > 300 ? 'ОЖИДАЙТЕ' : 'ПРОПУСТИТЬ';
      } else if (pmData.status === 'live' && pmPrice > 0 && pmPrice < 0.20) {
        // PM price says opposite direction is winning (conflict text already added in section 9)
        v.action = pmData.secsRemaining > 300 ? 'ОЖИДАЙТЕ' : 'ПРОПУСТИТЬ';
      } else {
        v.action = direction === 'UP' ? 'ВХОД UP' : 'ВХОД DOWN';
      }
    } else {
      v.action = 'ЖДАТЬ';
    }
  }

  if (v.action.startsWith('ВХОД')) {
    v.sizePerc = Math.round(15 * confidence * atrCfg.multiplier);
  }

  // Debug
  console.log('[SmartAlg]', {
    votes, up: upVotes, dn: downVotes, direction,
    base: baseConf.toFixed(2), bonus: bonus.toFixed(3), conf: confidence.toFixed(3),
    action: v.action,
    w: { rsi: wRsi.toFixed(3), macdH: wMacdHist.toFixed(3), macdX: wMacdCross.toFixed(3), vwap: wVwap.toFixed(3), ema: wEma.toFixed(3), piv: wPivots.toFixed(3), ha: wHa.toFixed(3), '3c': wThreeCandle.toFixed(3), mtf: wMtf.toFixed(3), stoch: wStoch.toFixed(3), bb: wBb.toFixed(3), rsiDiv: wRsiDiv.toFixed(3), atrZ: wAtrZone.toFixed(3) }
  });

  return v;
}
