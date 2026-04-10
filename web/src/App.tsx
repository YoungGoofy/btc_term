import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines, connectWS } from './api';
import type { BinanceWsInstance } from './api';
import { computeAll } from './indicators';
import type { ComputedData } from './indicators';
import {
  createPriceChart,
  createEmaChart,
  createMacdChart,
  syncCharts,
  resizeChart,
} from './chartSetup';
import type {
  PriceChartBundle,
  EmaChartBundle,
  MacdChartBundle,
} from './chartSetup';
import type { Candle } from './types';
import { initPolymarket, EMPTY_PM } from './polymarket';
import type { PolymarketData } from './polymarket';

const SYMBOL = 'BTCUSDT';
const MAX_CANDLES = 500;

interface AppState {
  loading: boolean;
  error: string;
  currentPrice: number;
  tickCount: number;
  atrValue: number;
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
  });
  const [clocks, setClocks] = useState({ 
    msk: '', 
    gmt: '', 
    et: '',
    session: { name: '', emoji: '', className: '' }
  });
  const [pmData, setPmData] = useState<PolymarketData>(EMPTY_PM);

  // DOM refs for chart containers.
  const priceRef = useRef<HTMLDivElement>(null);
  const emaRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  // Chart bundle refs (imperative, outside React state for performance).
  const priceChartRef = useRef<PriceChartBundle | null>(null);
  const emaChartRef = useRef<EmaChartBundle | null>(null);
  const macdChartRef = useRef<MacdChartBundle | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const wsRef = useRef<BinanceWsInstance | null>(null);

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

  useEffect(() => {
    const cleanup = initPolymarket((data) => setPmData(data));
    return () => cleanup();
  }, []);

  // Feed computed data to all chart series.
  const setAllData = useCallback((data: ComputedData) => {
    const pc = priceChartRef.current;
    const ec = emaChartRef.current;
    const mc = macdChartRef.current;
    if (!pc || !ec || !mc) return;

    // Price panel.
    pc.candleSeries.setData(data.ha.map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    pc.vwapSeries.setData(data.vwap.center);
    pc.vwapUpperSeries.setData(data.vwap.upper);
    pc.vwapLowerSeries.setData(data.vwap.lower);
    pc.rsiSeries.setData(data.rsi.map((r) => 'value' in r ? { time: r.time, value: r.value } : { time: r.time }));

    // EMA panel.
    ec.ema9Series.setData(data.ema9.map((e) => 'value' in e ? { time: e.time, value: e.value } : { time: e.time }));
    ec.ema21Series.setData(data.ema21.map((e) => 'value' in e ? { time: e.time, value: e.value } : { time: e.time }));
    ec.pivotHighSeries.setData(data.pivotHighs);
    ec.pivotLowSeries.setData(data.pivotLows);

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
    ec.chart.timeScale().setVisibleLogicalRange(range);
    mc.chart.timeScale().setVisibleLogicalRange(range);
  }, []);

  // Update last data point on each tick (efficient — no full redraw).
  const updateLast = useCallback((data: ComputedData) => {
    const pc = priceChartRef.current;
    const ec = emaChartRef.current;
    const mc = macdChartRef.current;
    if (!pc || !ec || !mc) return;

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
    if (data.rsi.length > 0) {
      const r = data.rsi[data.rsi.length - 1];
      if ('value' in r) pc.rsiSeries.update({ time: r.time, value: r.value });
    }
    if (data.ema9.length > 0) {
      const e = data.ema9[data.ema9.length - 1];
      if ('value' in e) ec.ema9Series.update({ time: e.time, value: e.value });
    }
    if (data.ema21.length > 0) {
      const e = data.ema21[data.ema21.length - 1];
      if ('value' in e) ec.ema21Series.update({ time: e.time, value: e.value });
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

  // ─── Main effect: create charts, fetch data, connect WS ─────

  useEffect(() => {
    if (!priceRef.current || !emaRef.current || !macdRef.current) return;

    // Create chart instances.
    const pc = createPriceChart(priceRef.current);
    const ec = createEmaChart(emaRef.current);
    const mc = createMacdChart(macdRef.current);

    priceChartRef.current = pc;
    emaChartRef.current = ec;
    macdChartRef.current = mc;

    // Sync scrolling and crosshair across all charts.
    syncCharts([
      { chart: pc.chart, series: pc.candleSeries },
      { chart: ec.chart, series: ec.ema9Series },
      { chart: mc.chart, series: mc.macdSeries },
    ]);

    // Fetch historical data.
    setState((s) => ({ ...s, loading: true, error: '', tickCount: 0 }));

    fetchKlines(SYMBOL, interval, MAX_CANDLES)
      .then((candles) => {
        candlesRef.current = candles;
        const computed = computeAll(candles);
        setAllData(computed);
        setState((s) => ({
          ...s,
          loading: false,
          currentPrice: candles.length > 0 ? candles[candles.length - 1].close : 0,
          atrValue: computed.atrValue,
        }));
      })
      .catch((err) => {
        setState((s) => ({ ...s, loading: false, error: err.message }));
      });

    // Connect WebSocket.
    const ws = connectWS(SYMBOL, interval, (tick) => {
      const candles = candlesRef.current;
      if (candles.length > 0 && candles[candles.length - 1].time === tick.time) {
        candles[candles.length - 1] = tick;
      } else {
        candles.push(tick);
        if (candles.length > MAX_CANDLES) candles.shift();
      }

      const computed = computeAll(candles);
      updateLast(computed);
      setState((s) => ({
        ...s,
        error: '', // Clear any previous reconnect errors
        currentPrice: tick.close,
        tickCount: s.tickCount + 1,
        atrValue: computed.atrValue,
      }));
    }, () => {
      setState((s) => ({ ...s, error: 'WebSocket disconnected' }));
    });
    wsRef.current = ws;

    // Resize handler.
    const onResize = () => {
      if (priceRef.current) resizeChart(pc.chart, priceRef.current);
      if (emaRef.current) resizeChart(ec.chart, emaRef.current);
      if (macdRef.current) resizeChart(mc.chart, macdRef.current);
    };
    window.addEventListener('resize', onResize);

    return () => {
      ws.close();
      pc.destroy();
      ec.destroy();
      mc.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, [interval, setAllData, updateLast]);

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
          <select
            className="interval-select"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {intervals.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
          <span className="label">Heikin Ashi</span>
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
            <div className="panel-label">Price · <span style={{ color: '#FF9800' }}>VWAP</span> · <span style={{ color: '#E040FB' }}>RSI</span></div>
          </div>
          <div className="panel panel-ema" ref={emaRef}>
            <div className="panel-label">
              <span style={{ color: '#2196F3' }}>EMA 9</span> ·{' '}
              <span style={{ color: '#9C27B0' }}>EMA 21</span> ·{' '}
              <span style={{ color: '#F48FB1' }}>Pivots HL</span>
            </div>
          </div>
          <div className="panel panel-macd" ref={macdRef}>
            <div className="panel-label">
              <span style={{ color: '#2196F3' }}>MACD</span> ·{' '}
              <span style={{ color: '#FF9800' }}>Signal</span>
            </div>
          </div>
        </div>

        {/* Polymarket sidebar */}
        <aside className="pm-sidebar">
          <div className="pm-header">
            <span className="pm-logo">◆ Polymarket</span>
            <span className={`pm-status pm-status-${pmData.status}`}>
              {pmData.status === 'live' ? '● Live' : pmData.status === 'loading' ? '◌ …' : pmData.status === 'waiting' ? '◎ Wait' : '✕ Err'}
            </span>
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
              <div className="pm-card-spread">spread: {(pmData.spreadUp * 100).toFixed(2)}¢</div>
            </div>
            <div className="pm-card pm-card-down">
              <div className="pm-card-label">DOWN ▼</div>
              <div className="pm-card-price">{pmData.priceDown > 0 ? (pmData.priceDown * 100).toFixed(1) + '¢' : '—'}</div>
              <div className="pm-card-spread">spread: {(pmData.spreadDown * 100).toFixed(2)}¢</div>
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
        </aside>
      </div>
    </div>
  );
}
