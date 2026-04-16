import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines, connectWS } from './api';
import type { BinanceWsInstance } from './api';
import { computeAll } from './indicators';
import type { ComputedData } from './indicators';
import {
  createPriceChart,
  createRsiChart,
  createMacdChart,
  syncCharts,
  resizeChart,
} from './chartSetup';
import type {
  PriceChartBundle,
  RsiChartBundle,
  MacdChartBundle,
} from './chartSetup';
import type { Candle } from './types';
import { initPolymarket, EMPTY_PM } from './polymarket';
import type { PolymarketData } from './polymarket';
import { MTFManager } from './mtf';
import type { MTFRecord } from './mtf';
import { computePrediction } from './smartAlg';
import type { SmartVerdict } from './smartAlg';
import { logSignalEntry, logSignalResult, downloadLog } from './signalLog';

const SYMBOL = 'BTCUSDT';
const MAX_CANDLES = 500;

interface AppState {
  loading: boolean;
  error: string;
  currentPrice: number;
  tickCount: number;
  atrValue: number;
  verdict: SmartVerdict | null;
}

interface TradeTracker {
  windowStart: number;
  direction: 'UP' | 'DOWN';
}

interface SignalHistoryEntry {
  time: string;
  windowTs: number;
  action: string;
  confidence: number;
  result: 'win' | 'loss' | 'pending' | 'skip';
  delta: number | null;
}

// ─── ATR zone helper ──────────────────────────

function atrZone(atr: number): { label: string; className: string } {
  if (atr < 30) return { label: '🔇 Тихий', className: 'atr-quiet' };
  if (atr < 60) return { label: '🔵 Умеренный', className: 'atr-moderate' };
  if (atr < 100) return { label: '🟡 Золотая', className: 'atr-golden' };
  if (atr < 120) return { label: '🔴 Высокий', className: 'atr-high' };
  return { label: '⚠️ Экстрем', className: 'atr-extreme' };
}

// ─── Clock helper ─────────────────────────────

function formatTZ(date: Date, tz: string): string {
  return date.toLocaleTimeString('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getTradingSession(now: Date): { name: string; emoji: string; className: string } {
  let etHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric' }), 10);
  if (etHour === 24) etHour = 0;

  if (etHour >= 20 || etHour < 6) return { name: 'Ночь / Азия', emoji: '✅', className: 'session-asia' };
  if (etHour >= 6 && etHour < 10) return { name: 'Лондон + NY', emoji: '🏆', className: 'session-london-ny' };
  if (etHour >= 10 && etHour < 15) return { name: 'NY Мидday', emoji: '⚠️', className: 'session-ny-mid' };
  if (etHour >= 15 && etHour < 16) return { name: '15:00 Окно', emoji: '✅', className: 'session-window' };
  if (etHour >= 16 && etHour < 20) return { name: 'Pacific', emoji: '❌', className: 'session-pacific' };

  return { name: '', emoji: '', className: '' };
}

export default function App() {
  const [interval, setInterval] = useState('15m');
  const [state, setState] = useState<AppState>({
    loading: true,
    error: '',
    currentPrice: 0,
    tickCount: 0,
    atrValue: 0,
    verdict: null,
  });
  const [showEMA, setShowEMA] = useState(true);
  const [showVWAP, setShowVWAP] = useState(true);
  const [showBB, setShowBB] = useState(true);
  const [showStoch, setShowStoch] = useState(true);
  
  const [tracker, setTracker] = useState<TradeTracker | null>(null);
  const [winStreak, setWinStreak] = useState<{result: '+' | '-', direction: string}[]>([]);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryEntry[]>([]);
  const [clocks, setClocks] = useState({ 
    msk: '', 
    gmt: '', 
    et: '',
    session: { name: '', emoji: '', className: '' }
  });
  const [pmData, setPmData] = useState<PolymarketData>(EMPTY_PM);
  const [mtfData, setMtfData] = useState<MTFRecord | null>(null);

  // DOM refs for chart containers.
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  // Chart bundle refs (imperative, outside React state for performance).
  const priceChartRef = useRef<PriceChartBundle | null>(null);
  const rsiChartRef = useRef<RsiChartBundle | null>(null);
  const macdChartRef = useRef<MacdChartBundle | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const cacheRef = useRef<Record<string, Candle[]>>({});
  const wsRef = useRef<BinanceWsInstance | null>(null);
  const lockedSignalRef = useRef<{ windowTs: number; action: string; direction: string; confidence: number } | null>(null);

  // ─── Clocks tick every second ───────────────

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClocks({
        msk: formatTZ(now, 'Europe/Moscow'),
        gmt: formatTZ(now, 'UTC'),
        et: formatTZ(now, 'America/New_York'),
        session: getTradingSession(now),
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ─── Polymarket init ────────────────────────
  const isInitializedRef = useRef(false);
  const activeIntervalRef = useRef(interval);
  activeIntervalRef.current = interval;

  useEffect(() => {
    const mtfManager = new MTFManager(SYMBOL);
    mtfManager.onUpdate((updatedTf, data) => {
      setMtfData({ ...data }); // React state update for AI tracking

      if (updatedTf === activeIntervalRef.current && data[updatedTf]) {
        const ha = data[updatedTf]!.ha;
        
        if (!isInitializedRef.current) {
          setAllData(data[updatedTf]!);
          isInitializedRef.current = true;
          setState((s) => ({
            ...s,
            loading: false,
            error: '',
            currentPrice: ha.length > 0 ? ha[ha.length - 1].close : 0,
            tickCount: s.tickCount + 1,
          }));
        } else {
          updateLast(data[updatedTf]!);
          setState((s) => ({
            ...s,
            currentPrice: ha.length > 0 ? ha[ha.length - 1].close : 0,
            tickCount: s.tickCount + 1,
          }));
        }
      }
    });
    mtfManager.start();

    const cleanup = initPolymarket((data) => setPmData(data));
    return () => {
      cleanup();
      mtfManager.stop();
    };
  }, []);

  // Sync main visual charts when interval changes & data becomes available
  useEffect(() => {
    isInitializedRef.current = false;
    if (mtfData && mtfData[interval]) {
      const data = mtfData[interval]!;
      setAllData(data);
      isInitializedRef.current = true;
      const ha = data.ha;
      setState((s) => ({
        ...s,
        loading: false,
        error: '',
        currentPrice: ha.length > 0 ? ha[ha.length - 1].close : 0,
        atrValue: data.atrValue,
      }));
    } else {
      setState(s => ({ ...s, loading: true, error: '' }));
    }
  }, [interval]); // DOES NOT depend on mtfData directly to avoid full redraws!

  // Feed computed data to all chart series.
  const setAllData = useCallback((data: ComputedData) => {
    const pc = priceChartRef.current;
    const rc = rsiChartRef.current;
    const mc = macdChartRef.current;
    if (!pc || !rc || !mc) return;

    // Price panel.
    pc.candleSeries.setData(data.ha.map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    pc.vwapSeries.setData(data.vwap.center);
    pc.vwapUpperSeries.setData(data.vwap.upper);
    pc.vwapLowerSeries.setData(data.vwap.lower);
    pc.ema9Series.setData(data.ema9.map((e) => 'value' in e ? { time: e.time, value: e.value } : { time: e.time }));
    pc.ema21Series.setData(data.ema21.map((e) => 'value' in e ? { time: e.time, value: e.value } : { time: e.time }));

    pc.bbUpperSeries.setData(data.bb.map((b) => 'upper' in b ? { time: b.time, value: b.upper } : { time: b.time }));
    pc.bbLowerSeries.setData(data.bb.map((b) => 'lower' in b ? { time: b.time, value: b.lower } : { time: b.time }));

    pc.pivotHighSeries.setData(data.pivotHighs);
    pc.pivotLowSeries.setData(data.pivotLows);

    // RSI panel.
    rc.rsiSeries.setData(data.rsi.map((r) => 'value' in r ? { time: r.time, value: r.value } : { time: r.time }));
    rc.stochKSeries.setData(data.stochRSI.map((s) => 'k' in s ? { time: s.time, value: s.k <= 1 ? s.k * 100 : s.k } : { time: s.time }));
    rc.stochDSeries.setData(data.stochRSI.map((s) => 'd' in s ? { time: s.time, value: s.d <= 1 ? s.d * 100 : s.d } : { time: s.time }));

    // MACD panel.
    mc.histSeries.setData(data.macd.map((m) => {
      if ('histogram' in m) {
        return {
          time: m.time,
          value: m.histogram,
          color: m.histogram >= 0 ? '#26A69A' : '#EF5350',
        };
      }
      return { time: m.time };
    }));
    mc.macdSeries.setData(data.macd.map((m) => 'macd' in m ? { time: m.time, value: m.macd } : { time: m.time }));
    mc.signalSeries.setData(data.macd.map((m) => 'signal' in m ? { time: m.time, value: m.signal } : { time: m.time }));

    // ↓↓↓ НАСТРОЙКА МАСШТАБА: измените число ниже, чтобы показывать
    //     больше (200) или меньше (30) свечей при загрузке.
    const VISIBLE_BARS = 80;
    const totalBars = data.ha.length;
    const range = { from: totalBars - VISIBLE_BARS, to: totalBars };
    pc.chart.timeScale().setVisibleLogicalRange(range);
    rc.chart.timeScale().setVisibleLogicalRange(range);
    mc.chart.timeScale().setVisibleLogicalRange(range);
  }, []);

  // Update last data point on each tick (efficient — no full redraw).
  const updateLast = useCallback((data: ComputedData) => {
    const pc = priceChartRef.current;
    const rc = rsiChartRef.current;
    const mc = macdChartRef.current;
    if (!pc || !rc || !mc) return;

    const ha = data.ha;
    if (ha.length > 0) {
      const last = ha[ha.length - 1];
      pc.candleSeries.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
    }
    if (data.vwap.center.length > 0) {
      pc.vwapSeries.update(data.vwap.center[data.vwap.center.length - 1]);
      pc.vwapUpperSeries.update(data.vwap.upper[data.vwap.upper.length - 1]);
      pc.vwapLowerSeries.update(data.vwap.lower[data.vwap.lower.length - 1]);
    }
    if (data.ema9.length > 0) {
      const e = data.ema9[data.ema9.length - 1];
      if ('value' in e) pc.ema9Series.update({ time: e.time, value: e.value });
    }
    if (data.ema21.length > 0) {
      const e = data.ema21[data.ema21.length - 1];
      if ('value' in e) pc.ema21Series.update({ time: e.time, value: e.value });
    }
    if (data.rsi.length > 0) {
      const r = data.rsi[data.rsi.length - 1];
      if ('value' in r) rc.rsiSeries.update({ time: r.time, value: r.value });
    }
    if (data.stochRSI.length > 0) {
      const s = data.stochRSI[data.stochRSI.length - 1];
      if ('k' in s) {
        rc.stochKSeries.update({ time: s.time, value: s.k <= 1 ? s.k * 100 : s.k });
        rc.stochDSeries.update({ time: s.time, value: s.d <= 1 ? s.d * 100 : s.d });
      }
    }
    if (data.bb.length > 0) {
      const b = data.bb[data.bb.length - 1];
      if ('upper' in b) {
        pc.bbUpperSeries.update({ time: b.time, value: b.upper });
        pc.bbLowerSeries.update({ time: b.time, value: b.lower });
      }
    }
    if (data.pivotHighs.length > 0) {
      pc.pivotHighSeries.update(data.pivotHighs[data.pivotHighs.length - 1]);
    }
    if (data.pivotLows.length > 0) {
      pc.pivotLowSeries.update(data.pivotLows[data.pivotLows.length - 1]);
    }

    if (data.macd.length > 0) {
      const m = data.macd[data.macd.length - 1];
      if ('histogram' in m) {
        mc.histSeries.update({ time: m.time, value: m.histogram, color: m.histogram >= 0 ? '#26A69A' : '#EF5350' });
        mc.macdSeries.update({ time: m.time, value: m.macd });
        mc.signalSeries.update({ time: m.time, value: m.signal });
      }
    }
  }, []);

  // ─── Apply Visibility Options ───────────────
  useEffect(() => {
    const pc = priceChartRef.current;
    const rc = rsiChartRef.current;
    if (pc) {
      pc.vwapSeries.applyOptions({ visible: showVWAP });
      pc.vwapUpperSeries.applyOptions({ visible: showVWAP });
      pc.vwapLowerSeries.applyOptions({ visible: showVWAP });
      pc.ema9Series.applyOptions({ visible: showEMA });
      pc.ema21Series.applyOptions({ visible: showEMA });
      pc.bbUpperSeries.applyOptions({ visible: showBB });
      pc.bbLowerSeries.applyOptions({ visible: showBB });
    }
    if (rc) {
      rc.stochKSeries.applyOptions({ visible: showStoch });
      rc.stochDSeries.applyOptions({ visible: showStoch });
    }
  }, [showVWAP, showEMA, showBB, showStoch]);

  // ─── Auto-Tracker for Winstreak + Signal History ─────────────
  const lastEntryWindowRef = useRef<number>(0); // tracks which window got ВХОД recorded
  const PM_WIN_THRESHOLD = 0.93; // 93¢ = trade worked
  
  useEffect(() => {
    if (!state.verdict) return;
    
    // Записать сигнал в историю, когда ВХОД появляется впервые для этого окна
    if (pmData.currentWindowTs > 0 
        && state.verdict.action.startsWith('ВХОД') 
        && pmData.currentWindowTs !== lastEntryWindowRef.current) {
      lastEntryWindowRef.current = pmData.currentWindowTs;
      const timeStr = new Date(pmData.currentWindowTs * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      setSignalHistory(prev => [
        {
          time: timeStr,
          windowTs: pmData.currentWindowTs,
          action: state.verdict!.action,
          confidence: state.verdict!.confidence,
          result: 'pending',
          delta: null,
        },
        ...prev.slice(0, 4), // keep last 5 entry signals
      ]);
      // Log to persistent storage
      logSignalEntry(state.verdict!, pmData);
    }
    
    // Если есть сигнал ВХОД, трекер не установлен, и время до конца окна > 60 сек
    if (state.verdict.action.startsWith('ВХОД') && !tracker && pmData.secsRemaining > 60) {
      setTracker({
        windowStart: pmData.currentWindowTs,
        direction: state.verdict.action === 'ВХОД UP' ? 'UP' : 'DOWN'
      });
    }

    // Проверка результата по PM цене (93¢ порог)
    if (tracker && tracker.windowStart === pmData.currentWindowTs) {
      const pmPrice = tracker.direction === 'UP' ? pmData.priceUp : pmData.priceDown;
      
      if (pmPrice >= PM_WIN_THRESHOLD) {
        // PM цена достигла 93¢ — сделка сработала!
        setWinStreak(prev => [...prev.slice(-19), { result: '+', direction: tracker.direction }]);
        setSignalHistory(prev => prev.map(e => 
          e.windowTs === tracker.windowStart 
            ? { ...e, result: 'win' as const, delta: pmPrice } 
            : e
        ));
        logSignalResult(tracker.windowStart, 'win', state.verdict, pmData);
        setTracker(null);
      }
    }

    // Окно сменилось, а 93¢ не было достигнуто → LOSS
    if (tracker && pmData.currentWindowTs > tracker.windowStart) {
      setWinStreak(prev => [...prev.slice(-19), { result: '-', direction: tracker.direction }]);
      setSignalHistory(prev => prev.map(e => 
        e.windowTs === tracker.windowStart && e.result === 'pending'
          ? { ...e, result: 'loss' as const } 
          : e
      ));
      logSignalResult(tracker.windowStart, 'loss', state.verdict, pmData);
      setTracker(null);
    }
  }, [state.verdict, pmData.currentWindowTs, pmData.priceUp, pmData.priceDown]);

  // Recalculate verdict when MTF or PM data updates independently
  useEffect(() => {
    if (mtfData && mtfData[interval]) {
      const v = computePrediction(mtfData, pmData, interval);

      // Reset lock when window changes
      const locked = lockedSignalRef.current;
      if (locked && locked.windowTs !== pmData.currentWindowTs) {
        lockedSignalRef.current = null;
      }

      // Signal locking: once ВХОД is given for a window, keep it
      // BUT: ОЖИДАЙТЕ and ПРОПУСТИТЬ always take priority (warmup, late entry, sideways)
      if (v.action === 'ОЖИДАЙТЕ' || v.action === 'ПРОПУСТИТЬ') {
        // Don't override — these are hard constraints
      } else if (lockedSignalRef.current && lockedSignalRef.current.windowTs === pmData.currentWindowTs && lockedSignalRef.current.action.startsWith('ВХОД')) {
        // Keep the locked entry signal
        v.action = lockedSignalRef.current.action as any;
        v.direction = lockedSignalRef.current.direction as any;
        v.confidence = lockedSignalRef.current.confidence;
        v.totalWeight = lockedSignalRef.current.confidence;
      } else if (v.action.startsWith('ВХОД')) {
        // Lock new entry signal
        lockedSignalRef.current = {
          windowTs: pmData.currentWindowTs,
          action: v.action,
          direction: v.direction,
          confidence: v.confidence,
        };
      }

      setState(s => ({ ...s, verdict: v }));
    }
  }, [interval, mtfData, pmData]);

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || !macdRef.current) return;

    // Create chart instances.
    const pc = createPriceChart(priceRef.current);
    const rc = createRsiChart(rsiRef.current);
    const mc = createMacdChart(macdRef.current);

    priceChartRef.current = pc;
    rsiChartRef.current = rc;
    macdChartRef.current = mc;

    // Sync scrolling and crosshair across all charts.
    syncCharts([
      { chart: pc.chart, series: pc.candleSeries },
      { chart: rc.chart, series: rc.rsiSeries },
      { chart: mc.chart, series: mc.macdSeries },
    ]);

    // Force initial render check just in case interval logic raced
    if (mtfData && mtfData[interval]) {
      setAllData(mtfData[interval]!);
    }

    // Resize handler.
    const onResize = () => {
      if (priceRef.current) resizeChart(pc.chart, priceRef.current);
      if (rsiRef.current) resizeChart(rc.chart, rsiRef.current);
      if (macdRef.current) resizeChart(mc.chart, macdRef.current);
    };
    window.addEventListener('resize', onResize);

    return () => {
      pc.destroy();
      rc.destroy();
      mc.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, []); // Only run once on mount

  // ─── Render ─────────────────────────────────

  const intervals = ['1m', '5m', '15m', '4h'];

  const priceClass = state.currentPrice > 0
    ? 'price-up'
    : 'price-down';

  const atr = atrZone(state.atrValue);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="symbol">₿ BTCUSDT</span>
          <div className="interval-buttons" style={{ display: 'flex', gap: '4px' }}>
            {intervals.map((tf) => (
              <button
                key={tf}
                className="interval-btn"
                style={{ 
                  background: interval === tf ? '#2A2E39' : '#1E222D', 
                  border: `1px solid ${interval === tf ? '#F0B90B' : '#2B2B43'}`, 
                  color: interval === tf ? '#F0B90B' : '#D1D4DC',
                  padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600
                }}
                onClick={() => setInterval(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          <span className="label">Heikin Ashi</span>
            <div className="header-toggles">
              <label><input type="checkbox" checked={showEMA} onChange={e => setShowEMA(e.target.checked)} /> <span>EMA</span></label>
              <label><input type="checkbox" checked={showVWAP} onChange={e => setShowVWAP(e.target.checked)} /> <span>VWAP</span></label>
              <label><input type="checkbox" checked={showBB} onChange={e => setShowBB(e.target.checked)} /> <span>BB</span></label>
              <label><input type="checkbox" checked={showStoch} onChange={e => setShowStoch(e.target.checked)} /> <span>StochRSI</span></label>
            </div>
          <span className={`session-badge ${clocks.session.className}`}>
            {clocks.session.name} {clocks.session.emoji}
          </span>
          <span className={`atr-badge ${atr.className}`}>
            ATR: ${state.atrValue.toFixed(1)} · {atr.label}
          </span>
        </div>
        <div className="header-right">
          <div className="clocks">
            <span className="clock-item">🇷🇺 {clocks.msk}</span>
            <span className="clock-item">GMT {clocks.gmt}</span>
            <span className="clock-item">ET {clocks.et}</span>
          </div>
          <span className={`current-price ${priceClass}`}>
            {state.currentPrice > 0 ? state.currentPrice.toFixed(2) : '—'}
          </span>
          <span className="tick-count">ticks: {state.tickCount}</span>
          {state.error && <span className="error-badge">⚠ {state.error}</span>}
        </div>
      </header>

      {/* Main content: charts + sidebar */}
      <div className="main-content">
        {/* Chart column */}
        <div className="charts-column">
          <div className="panel panel-price" ref={priceRef}>
            {state.loading && <div className="loading-overlay"><div className="spinner" />Loading…</div>}
            <div className="panel-label">
              Price
              {showVWAP && <span style={{ color: '#FF9800' }}> · VWAP</span>}
              {showEMA && <><span style={{ color: '#2196F3' }}> · EMA 9</span><span style={{ color: '#9C27B0' }}> · 21</span></>}
              {showBB && <span style={{ color: '#26A69A' }}> · BB</span>}
              <span style={{ color: '#FF5252' }}> · Pivots</span>
            </div>
            {/* ─── Traffic Light Signal ─── */}
            {state.verdict && (
              <div className={`traffic-light traffic-light-${state.verdict.action.includes('UP') ? 'up' : state.verdict.action.includes('DOWN') ? 'down' : state.verdict.action === 'ЖДАТЬ' ? 'wait' : state.verdict.action === 'ОЖИДАЙТЕ' ? 'wait' : 'skip'}`}>
                <div className="traffic-light-dot" />
                <span className="traffic-light-label">
                  {state.verdict.action.includes('ВХОД') 
                    ? `${state.verdict.direction} ${Math.round(state.verdict.confidence * 100)}%` 
                    : state.verdict.action}
                </span>
              </div>
            )}
          </div>
          <div className="panel panel-rsi" ref={rsiRef}>
            <div className="panel-label">
              <span style={{ color: '#E040FB' }}>RSI</span>
              {showStoch && <><span style={{ color: '#00BCD4' }}> · StochRSI %K</span><span style={{ color: '#FF9800' }}> · %D</span></>}
            </div>
          </div>
          <div className="panel panel-macd" ref={macdRef}>
            <div className="panel-label">
              <span style={{ color: '#2196F3' }}>MACD</span> · <span style={{ color: '#FF9800' }}>Signal</span>
            </div>
          </div>
        </div>

        {/* Polymarket sidebar */}
        <aside className="pm-sidebar">
          <div className="pm-header">
            <span className="pm-logo">◆ Polymarket</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button 
                onClick={downloadLog} 
                title="Скачать лог сигналов"
                style={{ 
                  background: 'none', border: '1px solid #434651', borderRadius: '4px',
                  color: '#b2b5be', cursor: 'pointer', fontSize: '11px', padding: '2px 6px',
                }}
              >📥</button>
              <span className={`pm-status pm-status-${pmData.status}`}>
                {pmData.status === 'live' ? '● Live' : pmData.status === 'loading' ? '◌ …' : pmData.status === 'waiting' ? '◎ Wait' : '✕ Err'}
              </span>
            </div>
          </div>

          {/* Question + countdown */}
          <div className="pm-question">{pmData.question || 'BTC 15m — инициализация…'}</div>
          {pmData.currentWindowTs > 0 && (
            <div className="pm-countdown">
              ⏱ {Math.floor(pmData.secsRemaining / 60)}:{String(pmData.secsRemaining % 60).padStart(2, '0')}
            </div>
          )}

          {/* UP / DOWN cards */}
          <div className="pm-outcomes">
            <div className="pm-card pm-card-up">
              <div className="pm-card-label">UP ▲</div>
              <div className="pm-card-price">{pmData.priceUp > 0 ? (pmData.priceUp * 100).toFixed(1) + '¢' : '—'}</div>
            </div>
            <div className="pm-card pm-card-down">
              <div className="pm-card-label">DOWN ▼</div>
              <div className="pm-card-price">{pmData.priceDown > 0 ? (pmData.priceDown * 100).toFixed(1) + '¢' : '—'}</div>
            </div>
          </div>

          {/* History — colored indicators */}
          <div className="pm-history-title">История (последние окна)</div>
          <div className="pm-history">
            {pmData.history.length > 0 ? (
              pmData.history.map((h, i) => {
                const icon = h.winner === 'UP' ? '🟢' : h.winner === 'DOWN' ? '🔴' : '⚪';
                const timeStr = new Date(h.windowStart * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const deltaStr = h.delta != null
                  ? (h.delta >= 0 ? `+$${h.delta.toFixed(1)}` : `-$${Math.abs(h.delta).toFixed(1)}`)
                  : '—';
                return (
                  <div key={i} className="pm-history-row">
                    <span className="pm-history-icon">{icon}</span>
                    <span className="pm-history-time">{timeStr}</span>
                    <span className={`pm-history-delta ${h.delta != null && h.delta >= 0 ? 'delta-up' : 'delta-down'}`}>
                      {deltaStr}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="pm-history-empty">Нет данных</div>
            )}
          </div>

            {pmData.statusMsg && (
              <div className="pm-error">ℹ {pmData.statusMsg}</div>
            )}
          
            {state.verdict && (
              <div className="smart-assistant" style={{ marginTop: '12px', padding: '8px', background: '#1e222d', borderRadius: '8px', border: '1px solid #434651' }}>
                <div className="sa-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '12px' }}>🧠 AI Аналитика</span>
                  {(() => {
                    const wins = winStreak.filter(w => w.result === '+').length;
                    const total = winStreak.length;
                    const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
                    return (
                      <span style={{ fontSize: '11px', color: pct >= 50 ? '#26A69A' : '#EF5350', fontWeight: 600 }}>
                        WR: {pct}% ({wins}/{total})
                      </span>
                    );
                  })()}
                </div>
                {/* Win/Loss dots */}
                <div style={{ display: 'flex', gap: '2px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  {winStreak.map((w, i) => (
                    <span key={i} style={{ 
                      width: '8px', height: '8px', borderRadius: '50%', 
                      background: w.result === '+' ? '#26A69A' : '#EF5350',
                      flexShrink: 0,
                    }} title={`${w.result === '+' ? 'WIN' : 'LOSS'} ${w.direction}`} />
                  ))}
                  {winStreak.length === 0 && <span style={{color:'gray', fontSize: '10px'}}>Нет сделок</span>}
                </div>
                
                <div className={`sa-verdict verdict-${state.verdict.action.replace(' ', '-').toLowerCase()}`} style={{ padding: '6px', background: '#2a2e39', textAlign: 'center', borderRadius: '4px', marginBottom: '6px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
                    Направление: <span style={{ color: state.verdict.direction === 'UP' ? '#26a69a' : state.verdict.direction === 'DOWN' ? '#ef5350' : '#9e9e9e' }}>{state.verdict.direction === 'NONE' ? 'НЕ ЯСНО' : state.verdict.direction}</span>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: state.verdict.action.includes('UP') ? '#26a69a' : state.verdict.action.includes('DOWN') ? '#ef5350' : state.verdict.action === 'ЖДАТЬ' ? '#ffeb3b' : state.verdict.action === 'ОЖИДАЙТЕ' ? '#FF9800' : '#9e9e9e', background: 'rgba(0,0,0,0.2)', padding:'3px', borderRadius:'4px' }}>
                    {state.verdict.action.includes('ВХОД') ? `ВХОДИТЬ! (${Math.round(state.verdict.confidence * 100)}%)` : state.verdict.action}
                  </div>
                  {/* Progress bar confidence */}
                  <div style={{ height: '4px', background: '#1e222d', borderRadius: '2px', overflow: 'hidden', margin: '8px 0' }}>
                    <div style={{ 
                        width: `${Math.min(100, Math.max(0, state.verdict.confidence * 100))}%`, 
                        height: '100%', 
                        background: state.verdict.action.includes('ВХОД') ? (state.verdict.direction === 'UP' ? '#26a69a' : '#ef5350') : '#ffeb3b',
                        transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ fontSize: '12px', color: '#b2b5be', marginTop: '6px' }}>
                    Уверенность: {Math.round(state.verdict.confidence * 100)}%
                  </div>
                </div>

                {/* Vote Summary */}
                {state.verdict.coreVotes && (
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', marginBottom:'8px', background:'rgba(255,255,255,0.03)', borderRadius:'4px', fontSize:'12px' }}>
                    <span style={{ color: '#b2b5be', fontWeight: 600 }}>
                      Голоса: <span style={{ color: '#26A69A' }}>▲{state.verdict.voteCounts.up}</span> / <span style={{ color: '#EF5350' }}>▼{state.verdict.voteCounts.down}</span> / <span style={{ color: '#9E9E9E' }}>—{state.verdict.voteCounts.neutral}</span>
                    </span>
                    <span style={{ display:'flex', gap:'6px' }}>
                      {(['rsi','macd','vwap','ema','pivots'] as const).map((key) => {
                        const vote = (state.verdict!.coreVotes as any)[key] as number;
                        const label = key.toUpperCase();
                        const color = vote > 0 ? '#26A69A' : vote < 0 ? '#EF5350' : '#555';
                        const icon = vote > 0 ? '▲' : vote < 0 ? '▼' : '—';
                        return <span key={key} style={{ color, fontWeight: 600 }} title={label}>{icon}</span>;
                      })}
                    </span>
                  </div>
                )}

                <div className="sa-mtf-status" style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', marginBottom:'10px', background:'rgba(255,255,255,0.02)', borderRadius:'4px', fontSize:'13px' }}>
                  <span title="1m">1m: {state.verdict.mtfStatus['1m']}</span>
                  <span title="5m">5m: {state.verdict.mtfStatus['5m']}</span>
                  <span title="15m">15m: {state.verdict.mtfStatus['15m']}</span>
                  <span title="4h">4h: {state.verdict.mtfStatus['4h']}</span>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '12px', fontSize: '11px', color: state.verdict.factors.atr.color, backgroundColor: 'rgba(0,0,0,0.2)', padding:'4px', borderRadius:'4px' }}>
                  Режим: {state.verdict.atrMode} | Size: {state.verdict.sizePerc}%
                </div>

                <div className="sa-factors" style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {state.verdict.factors.pm && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>Цена PM:</span>
                      <span style={{ color: state.verdict.factors.pm.color }}>{state.verdict.factors.pm.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.ha && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>Candles HA:</span>
                      <span style={{ color: state.verdict.factors.ha.color }}>{state.verdict.factors.ha.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.threeCandle && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>3Candle Filter:</span>
                      <span style={{ color: state.verdict.factors.threeCandle.color }}>{state.verdict.factors.threeCandle.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.rsi && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>RSI:</span>
                      <span style={{ color: state.verdict.factors.rsi.color }}>{state.verdict.factors.rsi.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.macd && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>MACD Hist:</span>
                      <span style={{ color: state.verdict.factors.macd.color }}>{state.verdict.factors.macd.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.macdCrossover && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>MACD Cross:</span>
                      <span style={{ color: state.verdict.factors.macdCrossover.color }}>{state.verdict.factors.macdCrossover.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.vwap && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>VWAP Dist:</span>
                      <span style={{ color: state.verdict.factors.vwap.color }}>{state.verdict.factors.vwap.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.ema && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>EMA Spread:</span>
                      <span style={{ color: state.verdict.factors.ema.color }}>{state.verdict.factors.ema.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.pivots && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>Pivots HL:</span>
                      <span style={{ color: state.verdict.factors.pivots.color }}>{state.verdict.factors.pivots.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.stoch && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>StochRSI:</span>
                      <span style={{ color: state.verdict.factors.stoch.color }}>{state.verdict.factors.stoch.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.bb && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#b2b5be' }}>Bands:</span>
                      <span style={{ color: state.verdict.factors.bb.color }}>{state.verdict.factors.bb.text}</span>
                    </div>
                  )}
                  {state.verdict.factors.conflicts && state.verdict.factors.conflicts.length > 0 && (
                    <div style={{ marginTop: '8px', padding: '6px', fontSize: '11px', background: 'rgba(255, 235, 59, 0.1)', color: '#ffeb3b', borderRadius:'4px' }}>
                      <div style={{fontWeight: 'bold', marginBottom:'2px'}}>⚠️ Конфликты / Ограничения:</div>
                      <ul style={{ margin: 0, paddingLeft: '16px' }}>
                        {state.verdict.factors.conflicts.map((c, i) => (
                           <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Signal History Table ─── */}
            {signalHistory.length > 0 && (
              <div className="signal-history" style={{ marginTop: '12px', padding: '10px', background: '#1e222d', borderRadius: '8px', border: '1px solid #434651' }}>
                <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '12px', marginBottom: '8px' }}>📊 История сигналов</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ color: '#787B86', borderBottom: '1px solid #2B2B43' }}>
                      <th style={{ textAlign: 'left', padding: '3px 4px' }}>Окно</th>
                      <th style={{ textAlign: 'center', padding: '3px 4px' }}>Сигнал</th>
                      <th style={{ textAlign: 'center', padding: '3px 4px' }}>%</th>
                      <th style={{ textAlign: 'center', padding: '3px 4px' }}>Итог</th>
                      <th style={{ textAlign: 'right', padding: '3px 4px' }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalHistory.map((entry, i) => {
                      const resultIcon = entry.result === 'win' ? '✅' : entry.result === 'loss' ? '❌' : entry.result === 'pending' ? '⏳' : '—';
                      const resultColor = entry.result === 'win' ? '#26A69A' : entry.result === 'loss' ? '#EF5350' : entry.result === 'pending' ? '#ffeb3b' : '#787B86';
                      const actionColor = entry.action.includes('UP') ? '#26A69A' : entry.action.includes('DOWN') ? '#EF5350' : '#787B86';
                      const shortAction = entry.action.replace('ВХОД ', '↑↓').replace('ЖДАТЬ', 'WAIT').replace('ПРОПУСТИТЬ', 'SKIP');
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(43,43,67,0.5)' }}>
                          <td style={{ padding: '4px', color: '#b2b5be', fontVariantNumeric: 'tabular-nums' }}>{entry.time}</td>
                          <td style={{ padding: '4px', textAlign: 'center', color: actionColor, fontWeight: 600 }}>
                            {entry.action.includes('UP') ? '▲ UP' : entry.action.includes('DOWN') ? '▼ DN' : shortAction}
                          </td>
                          <td style={{ padding: '4px', textAlign: 'center', color: '#b2b5be' }}>
                            {entry.action.startsWith('ВХОД') ? `${Math.round(entry.confidence * 100)}%` : '—'}
                          </td>
                          <td style={{ padding: '4px', textAlign: 'center', color: resultColor }}>{resultIcon}</td>
                          <td style={{ padding: '4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: entry.delta != null && entry.delta >= 0 ? '#26A69A' : entry.delta != null ? '#EF5350' : '#787B86' }}>
                            {entry.delta != null ? (entry.delta >= 0 ? `+$${entry.delta.toFixed(0)}` : `-$${Math.abs(entry.delta).toFixed(0)}`) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
      </div>
    </div>
  );
}
