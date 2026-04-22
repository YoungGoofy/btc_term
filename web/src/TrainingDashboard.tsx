import { useEffect, useRef, useMemo } from 'react';
import { createChart, LineSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTrainingWS } from './hooks/useTrainingWS';
import type { MetricPoint, TrainingMetrics } from './hooks/useTrainingWS';

const CHART_BG = '#131722';
const GRID_COLOR = '#1E222D';
const BORDER_COLOR = '#2B2B43';
const TEXT_COLOR = '#787B86';

const PHASES = [
  { key: 'oracle_labeling', label: 'Oracle Labels', color: '#F0B90B' },
  { key: 'bc_pretrain', label: 'BC Pretrain', color: '#7C4DFF' },
  { key: 'ppo_frozen', label: 'PPO Frozen', color: '#42A5F5' },
  { key: 'ppo_unfrozen', label: 'PPO Unfrozen', color: '#26A69A' },
  { key: 'online_finetune', label: 'Online Finetune', color: '#FF7043' },
  { key: 'complete', label: 'Complete', color: '#66BB6A' },
];

function phaseLabel(phase: string): string {
  return PHASES.find(p => phase.startsWith(p.key))?.label ?? phase;
}

function phaseColor(phase: string): string {
  return PHASES.find(p => phase.startsWith(p.key))?.color ?? '#787B86';
}

function toLineData(points: MetricPoint[]) {
  return points.map(p => ({ time: p.step as unknown as UTCTimestamp, value: p.value }));
}

type UTCTimestamp = number;

function SimpleChart({
  data,
  color,
  label,
}: {
  data: { time: UTCTimestamp; value: number }[];
  color: string;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<'Line'> } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const chart = createChart(containerRef.current, {
      width: rect.width,
      height: rect.height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: TEXT_COLOR,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: BORDER_COLOR },
      timeScale: { borderColor: BORDER_COLOR, timeVisible: false },
    });
    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: true,
    });
    chartRef.current = { chart, series };
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [color]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;
    chartRef.current.series.setData(data as any);
  }, [data]);

  return (
    <div className="chart-panel">
      <div className="chart-label">{label}</div>
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}

function MultiLineChart({
  lines,
  label,
}: {
  lines: { key: string; data: { time: UTCTimestamp; value: number }[]; color: string }[];
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const chart = createChart(containerRef.current, {
      width: rect.width,
      height: rect.height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: TEXT_COLOR,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: BORDER_COLOR },
      timeScale: { borderColor: BORDER_COLOR, timeVisible: false },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    for (const line of lines) {
      let series = seriesRef.current.get(line.key);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: 2,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        seriesRef.current.set(line.key, series);
      }
      if (line.data.length > 0) {
        series.setData(line.data as any);
      }
    }
  }, [lines]);

  return (
    <div className="chart-panel">
      <div className="chart-label">{label}</div>
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}

function PhaseIndicator({ phase, progress }: { phase: string; progress: number }) {
  const activeColor = phaseColor(phase);
  return (
    <div className="phase-bar">
      {PHASES.map(p => {
        const isActive = phase.startsWith(p.key);
        const isPast = PHASES.findIndex(x => x.key === phase.split('_done')[0]) > PHASES.indexOf(p);
        return (
          <div
            key={p.key}
            className={`phase-segment ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
            style={{
              '--segment-color': isActive ? activeColor : isPast ? p.color : BORDER_COLOR,
            } as React.CSSProperties}
          >
            <span className="phase-label">{p.label}</span>
            {isActive && (
              <div className="phase-progress" style={{ width: `${progress * 100}%`, background: activeColor }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel({ metrics }: { metrics: TrainingMetrics }) {
  const last = (key: string) => {
    const pts = metrics.metrics[key];
    return pts?.length ? pts[pts.length - 1].value : null;
  };
  const fmt = (v: number | null, decimals = 4) => (v !== null ? v.toFixed(decimals) : '—');

  const stats = [
    { label: 'Phase', value: phaseLabel(metrics.phase), color: phaseColor(metrics.phase) },
    { label: 'Progress', value: `${(metrics.phase_progress * 100).toFixed(0)}%` },
    { label: 'Reward (mean)', value: fmt(last('rollout/ep_rew_mean')), color: '#26A69A' },
    { label: 'Policy Loss', value: fmt(last('train/policy_gradient_loss')), color: '#F0B90B' },
    { label: 'Value Loss', value: fmt(last('train/value_loss')), color: '#EF5350' },
    { label: 'Entropy', value: fmt(last('train/entropy_loss')), color: '#7C4DFF' },
    { label: 'BC Loss', value: fmt(last('bc/loss')), color: '#7C4DFF' },
    { label: 'KL', value: fmt(last('train/approx_kl')) },
    { label: 'Clip %', value: fmt(last('train/clip_fraction')) },
    { label: 'FPS', value: fmt(last('time/fps'), 0) },
    { label: 'LR', value: fmt(last('train/learning_rate'), 6) },
    { label: 'Episodes', value: String(metrics.episodes.length) },
  ];

  return (
    <div className="stats-panel">
      {stats.map(s => (
        <div key={s.label} className="stat-row">
          <span className="stat-label">{s.label}</span>
          <span className="stat-value" style={{ color: s.color || 'var(--text)' }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function EpisodeDots({ episodes }: { episodes: TrainingMetrics['episodes'] }) {
  const recent = episodes.slice(-200);
  return (
    <div className="episode-dots">
      <div className="stat-label">Episode Outcomes</div>
      <div className="dots-row">
        {recent.map((ep, i) => (
          <div
            key={i}
            className="episode-dot"
            style={{ background: ep.outcome === 'win' ? '#26A69A' : '#EF5350' }}
            title={`reward: ${ep.reward.toFixed(3)}`}
          />
        ))}
        {recent.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No episodes yet</span>}
      </div>
    </div>
  );
}

export default function TrainingDashboard() {
  const { metrics, connected } = useTrainingWS();

  const rewardData = useMemo(
    () => toLineData(metrics.metrics['rollout/ep_rew_mean'] || []),
    [metrics.metrics],
  );

  const bcLossData = useMemo(
    () => toLineData(metrics.metrics['bc/loss'] || []),
    [metrics.metrics],
  );

  const lossLines = useMemo(() => [
    { key: 'policy_gradient', data: toLineData(metrics.metrics['train/policy_gradient_loss'] || []), color: '#F0B90B' },
    { key: 'value_loss', data: toLineData(metrics.metrics['train/value_loss'] || []), color: '#EF5350' },
    { key: 'entropy', data: toLineData(metrics.metrics['train/entropy_loss'] || []), color: '#7C4DFF' },
  ], [metrics.metrics]);

  return (
    <div className="training-dashboard">
      <header className="training-header">
        <a href="/" className="back-link">&larr; Terminal</a>
        <h2>RL Training Dashboard</h2>
        <span className={`ws-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Live' : '○ Disconnected'}
        </span>
      </header>

      <PhaseIndicator phase={metrics.phase} progress={metrics.phase_progress} />

      <div className="training-body">
        <div className="training-charts">
          {rewardData.length > 0 && (
            <SimpleChart data={rewardData} color="#26A69A" label="Reward (ep_mean)" />
          )}
          {lossLines.some(l => l.data.length > 0) && (
            <MultiLineChart lines={lossLines} label="Training Losses (gold=policy, red=value, purple=entropy)" />
          )}
          {bcLossData.length > 0 && (
            <SimpleChart data={bcLossData} color="#7C4DFF" label="BC Pretrain Loss" />
          )}
          {rewardData.length === 0 && bcLossData.length === 0 && (
            <div className="chart-panel">
              <div className="chart-label">
                {metrics.phase === 'oracle_labeling'
                  ? 'Generating oracle labels... (charts will appear during BC/PPO training)'
                  : metrics.phase === 'idle'
                    ? (connected ? 'Waiting for training to start...' : 'Cannot connect to training server')
                    : 'Waiting for metrics data...'}
              </div>
              <div className="chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                Phase: {phaseLabel(metrics.phase)} ({(metrics.phase_progress * 100).toFixed(0)}%)
              </div>
            </div>
          )}
        </div>

        <div className="training-sidebar">
          <StatsPanel metrics={metrics} />
          <EpisodeDots episodes={metrics.episodes} />
        </div>
      </div>
    </div>
  );
}