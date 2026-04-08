import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines, connectWS } from './api';
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

export default function App() {
  const [interval, setInterval] = useState('1m');
  const [state, setState] = useState<AppState>({
    loading: true,
    error: '',
    currentPrice: 0,
    tickCount: 0,
    atrValue: 0,
  });
  const [clocks, setClocks] = useState({ msk: '', gmt: '', et: '' });

  // DOM refs for chart containers.
  const priceRef = useRef<HTMLDivElement>(null);
  const emaRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  // Chart bundle refs (imperative, outside React state for performance).
  const priceChartRef = useRef<PriceChartBundle | null>(null);
  const emaChartRef = useRef<EmaChartBundle | null>(null);
  const macdChartRef = useRef<MacdChartBundle | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // ─── Clocks tick every second ───────────────

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClocks({
        msk: formatTZ(now, 'Europe/Moscow'),
        gmt: formatTZ(now, 'UTC'),
        et: formatTZ(now, 'America/New_York'),
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
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
    pc.rsiSeries.setData(data.rsi);

    // EMA panel.
    ec.ema9Series.setData(data.ema9);
    ec.ema21Series.setData(data.ema21);
    ec.pivotHighSeries.setData(data.pivotHighs);
    ec.pivotLowSeries.setData(data.pivotLows);

    // MACD panel.
    mc.histSeries.setData(data.macd.map((m) => ({
      time: m.time,
      value: m.histogram,
      color: m.histogram >= 0 ? '#26A69A' : '#EF5350',
    })));
    mc.macdSeries.setData(data.macd.map((m) => ({ time: m.time, value: m.macd })));
    mc.signalSeries.setData(data.macd.map((m) => ({ time: m.time, value: m.signal })));

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
    if (data.rsi.length > 0) pc.rsiSeries.update(data.rsi[data.rsi.length - 1]);
    if (data.ema9.length > 0) ec.ema9Series.update(data.ema9[data.ema9.length - 1]);
    if (data.ema21.length > 0) ec.ema21Series.update(data.ema21[data.ema21.length - 1]);

    if (data.macd.length > 0) {
      const m = data.macd[data.macd.length - 1];
      mc.histSeries.update({ time: m.time, value: m.histogram, color: m.histogram >= 0 ? '#26A69A' : '#EF5350' });
      mc.macdSeries.update({ time: m.time, value: m.macd });
      mc.signalSeries.update({ time: m.time, value: m.signal });
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

    // Sync scrolling across all charts.
    syncCharts([pc.chart, ec.chart, mc.chart]);

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

      {/* Chart panels */}
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
  );
}
