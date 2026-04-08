import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

// ─── Theme ────────────────────────────────────

const CHART_BG = '#131722';
const GRID_COLOR = '#1E222D';
const BORDER_COLOR = '#2B2B43';
const TEXT_COLOR = '#787B86';

function defaultChartOptions(width: number, height: number) {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid as const, color: CHART_BG },
      textColor: TEXT_COLOR,
      fontFamily: "'Inter', sans-serif",
    },
    grid: {
      vertLines: { color: GRID_COLOR },
      horzLines: { color: GRID_COLOR },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: BORDER_COLOR },
    timeScale: {
      borderColor: BORDER_COLOR,
      timeVisible: true,
      secondsVisible: false,
    },
  };
}

// ─── Series Refs ──────────────────────────────

export interface ChartBundle {
  chart: IChartApi;
  destroy: () => void;
}

export interface PriceChartBundle extends ChartBundle {
  candleSeries: ISeriesApi<'Candlestick'>;
  vwapSeries: ISeriesApi<'Line'>;
  vwapUpperSeries: ISeriesApi<'Line'>;
  vwapLowerSeries: ISeriesApi<'Line'>;
  rsiSeries: ISeriesApi<'Line'>;
}

export interface EmaChartBundle extends ChartBundle {
  ema9Series: ISeriesApi<'Line'>;
  ema21Series: ISeriesApi<'Line'>;
  pivotHighSeries: ISeriesApi<'Line'>;
  pivotLowSeries: ISeriesApi<'Line'>;
}

export interface MacdChartBundle extends ChartBundle {
  histSeries: ISeriesApi<'Histogram'>;
  macdSeries: ISeriesApi<'Line'>;
  signalSeries: ISeriesApi<'Line'>;
}

// ─── Factories ────────────────────────────────

export function createPriceChart(container: HTMLElement): PriceChartBundle {
  const rect = container.getBoundingClientRect();
  const chart = createChart(container, defaultChartOptions(rect.width, rect.height));

  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26A69A',
    downColor: '#EF5350',
    borderVisible: false,
    wickUpColor: '#26A69A',
    wickDownColor: '#EF5350',
  });

  const vwapSeries = chart.addSeries(LineSeries, {
    color: '#FF9800',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const vwapUpperSeries = chart.addSeries(LineSeries, {
    color: 'rgba(255, 152, 0, 0.35)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const vwapLowerSeries = chart.addSeries(LineSeries, {
    color: 'rgba(255, 152, 0, 0.35)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // RSI on a separate left price scale (0-100).
  const rsiSeries = chart.addSeries(LineSeries, {
    color: '#E040FB',
    lineWidth: 1,
    priceScaleId: 'rsi',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  // Configure the RSI price scale on the left side.
  chart.priceScale('rsi').applyOptions({
    scaleMargins: { top: 0.7, bottom: 0.02 },
    borderVisible: false,
  });

  // RSI 30/70 reference lines.
  rsiSeries.createPriceLine({ price: 70, color: '#787B86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
  rsiSeries.createPriceLine({ price: 30, color: '#787B86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });

  return { chart, candleSeries, vwapSeries, vwapUpperSeries, vwapLowerSeries, rsiSeries, destroy: () => chart.remove() };
}

export function createEmaChart(container: HTMLElement): EmaChartBundle {
  const rect = container.getBoundingClientRect();
  const chart = createChart(container, defaultChartOptions(rect.width, rect.height));

  const ema9Series = chart.addSeries(LineSeries, {
    color: '#2196F3',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const ema21Series = chart.addSeries(LineSeries, {
    color: '#9C27B0',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const pivotHighSeries = chart.addSeries(LineSeries, {
    color: '#F48FB1',
    lineWidth: 1,
    pointMarkersVisible: true,
    pointMarkersRadius: 3,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const pivotLowSeries = chart.addSeries(LineSeries, {
    color: '#4FC3F7',
    lineWidth: 1,
    pointMarkersVisible: true,
    pointMarkersRadius: 3,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  return { chart, ema9Series, ema21Series, pivotHighSeries, pivotLowSeries, destroy: () => chart.remove() };
}

export function createMacdChart(container: HTMLElement): MacdChartBundle {
  const rect = container.getBoundingClientRect();
  const chart = createChart(container, defaultChartOptions(rect.width, rect.height));

  const histSeries = chart.addSeries(HistogramSeries, {
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const macdSeries = chart.addSeries(LineSeries, {
    color: '#2196F3',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const signalSeries = chart.addSeries(LineSeries, {
    color: '#FF9800',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  return { chart, histSeries, macdSeries, signalSeries, destroy: () => chart.remove() };
}

// ─── Time sync between charts ─────────────────

export function syncCharts(charts: IChartApi[]) {
  charts.forEach((chart, idx) => {
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      charts.forEach((other, otherIdx) => {
        if (idx !== otherIdx) {
          other.timeScale().setVisibleLogicalRange(range);
        }
      });
    });
  });
}

// ─── Resize helper ────────────────────────────

export function resizeChart(chart: IChartApi, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  chart.resize(rect.width, rect.height);
}

// Export time cast helper
export function toTime(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp;
}
