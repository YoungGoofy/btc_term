import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, Time } from 'lightweight-charts';

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
    rightPriceScale: { 
      borderColor: BORDER_COLOR,
      minimumWidth: 80, // Фиксированная ширина для идеального выравнивания таймлайна между панелями
    },
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
  ema9Series: ISeriesApi<'Line'>;
  ema21Series: ISeriesApi<'Line'>;
  bbUpperSeries: ISeriesApi<'Line'>;
  bbLowerSeries: ISeriesApi<'Line'>;
  pivotHighSeries: ISeriesApi<'Line'>;
  pivotLowSeries: ISeriesApi<'Line'>;
}

export interface RsiChartBundle extends ChartBundle {
  rsiSeries: ISeriesApi<'Line'>;
  stochKSeries: ISeriesApi<'Line'>;
  stochDSeries: ISeriesApi<'Line'>;
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

  const bbUpperSeries = chart.addSeries(LineSeries, {
    color: 'rgba(33, 150, 243, 0.5)',
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const bbLowerSeries = chart.addSeries(LineSeries, {
    color: 'rgba(33, 150, 243, 0.5)',
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const pivotHighSeries = chart.addSeries(LineSeries, {
    color: '#FF5252',
    lineWidth: 2,
    lineStyle: 2, // Dashed
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  const pivotLowSeries = chart.addSeries(LineSeries, {
    color: '#4CAF50',
    lineWidth: 2,
    lineStyle: 2, // Dashed
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  return { chart, candleSeries, vwapSeries, vwapUpperSeries, vwapLowerSeries, ema9Series, ema21Series, bbUpperSeries, bbLowerSeries, pivotHighSeries, pivotLowSeries, destroy: () => chart.remove() };
}

export function createRsiChart(container: HTMLElement): RsiChartBundle {
  const rect = container.getBoundingClientRect();
  const chart = createChart(container, defaultChartOptions(rect.width, rect.height));

  const rsiSeries = chart.addSeries(LineSeries, {
    color: '#E040FB',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  // RSI 30/70 reference lines.
  rsiSeries.createPriceLine({ price: 70, color: '#787B86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
  rsiSeries.createPriceLine({ price: 30, color: '#787B86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });

  // Stoch RSI reference lines.
  rsiSeries.createPriceLine({ price: 80, color: 'rgba(120, 123, 134, 0.5)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
  rsiSeries.createPriceLine({ price: 20, color: 'rgba(120, 123, 134, 0.5)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });

  const stochKSeries = chart.addSeries(LineSeries, {
    color: '#00BCD4',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  const stochDSeries = chart.addSeries(LineSeries, {
    color: '#FF9800',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  return { chart, rsiSeries, stochKSeries, stochDSeries, destroy: () => chart.remove() };
}

export function createMacdChart(container: HTMLElement): MacdChartBundle {
  const rect = container.getBoundingClientRect();
  const chart = createChart(container, defaultChartOptions(rect.width, rect.height));

  const histSeries = chart.addSeries(HistogramSeries, {
    priceLineVisible: false,
    lastValueVisible: true,
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

export interface SyncBundle {
  chart: IChartApi;
  series: ISeriesApi<any>;
}

export function syncCharts(bundles: SyncBundle[]) {
  let isSyncing = false;

  bundles.forEach((bundle, idx) => {
    // 1. Sync Logical Range (zooming / panning)
    bundle.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncing || !range) return;
      isSyncing = true;
      bundles.forEach((other, otherIdx) => {
        if (idx !== otherIdx) {
          other.chart.timeScale().setVisibleLogicalRange(range);
        }
      });
      isSyncing = false;
    });

    // 2. Sync Crosshair
    bundle.chart.subscribeCrosshairMove((param) => {
      if (isSyncing) return;
      isSyncing = true;
      // If the mouse is out of the chart, clear the crosshair on others
      if (!param.time || param.point === undefined || param.point.x < 0 || param.point.y < 0) {
        bundles.forEach((other, otherIdx) => {
          if (idx !== otherIdx) {
            other.chart.clearCrosshairPosition();
          }
        });
      } else {
        // Sync the crosshair on other charts
        bundles.forEach((other, otherIdx) => {
          if (idx !== otherIdx) {
            other.chart.setCrosshairPosition(NaN, param.time as Time, other.series);
          }
        });
      }
      isSyncing = false;
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
