import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/training`;
const REST_URL = `${window.location.origin}/training/metrics`;
const POLL_INTERVAL = 3000;
const MAX_RECONNECT_DELAY = 30_000;

export interface MetricPoint {
  step: number;
  value: number;
  ts: number;
}

export interface EpisodeRecord {
  reward: number;
  length: number;
  outcome: string;
  ts: number;
}

export interface TrainingMetrics {
  phase: string;
  phase_progress: number;
  last_update: number;
  metrics: Record<string, MetricPoint[]>;
  episodes: EpisodeRecord[];
}

function emptyMetrics(): TrainingMetrics {
  return {
    phase: 'idle',
    phase_progress: 0,
    last_update: 0,
    metrics: {},
    episodes: [],
  };
}

/** Merge incoming snapshot into existing metrics, deduplicating by step. */
function mergeMetrics(prev: TrainingMetrics, incoming: TrainingMetrics): TrainingMetrics {
  const merged: Record<string, MetricPoint[]> = { ...prev.metrics };
  for (const [key, points] of Object.entries(incoming.metrics)) {
    const existing = merged[key] || [];
    const existingSteps = new Set(existing.map(p => p.step));
    const newPoints = points.filter(p => !existingSteps.has(p.step));
    merged[key] = [...existing, ...newPoints];
  }
  return {
    phase: incoming.phase,
    phase_progress: incoming.phase_progress,
    last_update: incoming.last_update,
    metrics: merged,
    episodes: incoming.episodes,
  };
}

export function useTrainingWS() {
  const [metrics, setMetrics] = useState<TrainingMetrics>(emptyMetrics);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelay = useRef(1000);

  const connectWS = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000;
      // Stop polling if it was running
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: TrainingMetrics = JSON.parse(event.data);
        setMetrics(prev => mergeMetrics(prev, data));
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      setConnected(false);
      // Try reconnecting with backoff
      setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
        connectWS();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(REST_URL);
        const data: TrainingMetrics = await resp.json();
        setMetrics(prev => mergeMetrics(prev, data));
        setConnected(true);
      } catch {
        setConnected(false);
      }
    }, POLL_INTERVAL);
  }, []);

  useEffect(() => {
    connectWS();

    // Also start polling as fallback — stops when WS connects
    startPolling();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connectWS, startPolling]);

  return { metrics, connected };
}