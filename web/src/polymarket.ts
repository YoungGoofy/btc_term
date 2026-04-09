/**
 * Polymarket BTC 15m — slug-based real-time module.
 *
 * Architecture:
 *   1. Generate deterministic slugs from Unix timestamps (15-min windows)
 *   2. Scheduler fires at :00, :15, :30, :45 + 3s delay
 *   3. Batch-fetch history via Gamma REST (slug query)
 *   4. Stream live prices via CLOB WebSocket (auto-reconnect)
 */

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

export interface HistoryEntry {
  slug: string;
  windowStart: number;        // unix seconds
  winner: 'UP' | 'DOWN' | null;
  delta: number | null;       // $ price change in window
  priceToBeat: number | null; // start price
}

export interface PolymarketData {
  question: string;
  priceUp: number;
  priceDown: number;
  spreadUp: number;
  spreadDown: number;
  history: HistoryEntry[];
  status: 'loading' | 'live' | 'waiting' | 'error';
  statusMsg: string;
  currentWindowTs: number;
  secsRemaining: number;
}

export const EMPTY_PM: PolymarketData = {
  question: '',
  priceUp: 0,
  priceDown: 0,
  spreadUp: 0,
  spreadDown: 0,
  history: [],
  status: 'loading',
  statusMsg: 'Инициализация…',
  currentWindowTs: 0,
  secsRemaining: 0,
};

// ───────────────────────────────────────────────
// Slug / timestamp helpers
// ───────────────────────────────────────────────

const WINDOW_SEC = 15 * 60;
const SCHEDULER_DELAY_MS = 3_000;
const HISTORY_COUNT = 5;

function windowTimestamp(d: Date): number {
  const totalSec = Math.floor(d.getTime() / 1000);
  return totalSec - (totalSec % WINDOW_SEC);
}

function slug(ts: number): string {
  return `btc-updown-15m-${ts}`;
}

function windowTimestamps(now: Date, historyCount: number) {
  const current = windowTimestamp(now);
  const prev: number[] = [];
  for (let i = 1; i <= historyCount; i++) {
    prev.push(current - i * WINDOW_SEC);
  }
  return { current, prev };
}

// ───────────────────────────────────────────────
// Gamma REST
// ───────────────────────────────────────────────

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  lastTradePrice: number;
}

interface GammaEventMeta { priceToBeat?: string; }

interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  markets: GammaMarket[];
  active: boolean;
  closed: boolean;
  eventMetadata?: GammaEventMeta;
}

async function fetchEventsBySlugs(slugs: string[]): Promise<GammaEvent[]> {
  if (slugs.length === 0) return [];
  const params = slugs.map((s) => `slug=${encodeURIComponent(s)}`).join('&');
  try {
    const resp = await fetch(`/gamma-api/events?${params}`);
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

async function fetchMarketBySlug(s: string): Promise<GammaMarket | null> {
  try {
    const resp = await fetch(`/gamma-api/markets?slug=${encodeURIComponent(s)}`);
    if (!resp.ok) return null;
    const arr: GammaMarket[] = await resp.json();
    return arr.length > 0 ? arr[0] : null;
  } catch { return null; }
}

// ───────────────────────────────────────────────
// History builder
// ───────────────────────────────────────────────

function determineWinner(market: GammaMarket): 'UP' | 'DOWN' | null {
  if (!market.closed) return null;
  try {
    const outcomes: string[] = JSON.parse(market.outcomes);
    const prices: string[] = JSON.parse(market.outcomePrices);
    const upIdx = outcomes.findIndex((o) => o.toLowerCase() === 'up');
    if (upIdx >= 0 && prices[upIdx] === '1') return 'UP';
    if (upIdx >= 0 && prices[upIdx] === '0') return 'DOWN';
    const downIdx = outcomes.findIndex((o) => o.toLowerCase() === 'down');
    if (downIdx >= 0 && prices[downIdx] === '1') return 'DOWN';
    if (downIdx >= 0 && prices[downIdx] === '0') return 'UP';
  } catch { /* */ }
  return null;
}

function buildHistory(events: GammaEvent[], timestamps: number[]): HistoryEntry[] {
  const bySlug = new Map<string, GammaEvent>();
  for (const ev of events) bySlug.set(ev.slug, ev);

  const entries: HistoryEntry[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const s = slug(ts);
    const ev = bySlug.get(s);
    const nextTs = i === 0 ? timestamps[0] + WINDOW_SEC : timestamps[i - 1];
    const nextEv = bySlug.get(slug(nextTs));
    const market = ev?.markets?.[0];
    const winner = market ? determineWinner(market) : null;

    let delta: number | null = null;
    const ptbCurrent = ev?.eventMetadata?.priceToBeat ? parseFloat(ev.eventMetadata.priceToBeat) : null;
    const ptbNext = nextEv?.eventMetadata?.priceToBeat ? parseFloat(nextEv.eventMetadata.priceToBeat) : null;
    if (ptbCurrent != null && ptbNext != null && !isNaN(ptbCurrent) && !isNaN(ptbNext)) {
      delta = ptbNext - ptbCurrent;
    }

    entries.push({ slug: s, windowStart: ts, winner, delta, priceToBeat: ptbCurrent });
  }
  return entries;
}

// ───────────────────────────────────────────────
// WebSocket manager (auto-reconnect + 1s throttle)
// ───────────────────────────────────────────────

type PriceUpdate = {
  priceUp: number;
  priceDown: number;
  spreadUp: number;
  spreadDown: number;
};

class WsManager {
  private ws: WebSocket | null = null;
  private assetIds: string[] = [];
  private upTokenId = '';
  private downTokenId = '';
  private onUpdate: (u: Partial<PriceUpdate>) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private alive = true;

  // Buffered latest values — only flushed once per second
  private latestUp: { ask: number; bid: number } | null = null;
  private latestDown: { ask: number; bid: number } | null = null;
  private dirty = false;

  constructor(onUpdate: (u: Partial<PriceUpdate>) => void) {
    this.onUpdate = onUpdate;
    this.flushTimer = setInterval(() => this.flush(), 1_000);
  }

  private flush() {
    if (!this.dirty) return;
    const update: Partial<PriceUpdate> = {};
    if (this.latestUp) {
      update.priceUp = this.latestUp.ask;
      update.spreadUp = this.latestUp.ask > 0 && this.latestUp.bid > 0
        ? this.latestUp.ask - this.latestUp.bid : 0;
    }
    if (this.latestDown) {
      update.priceDown = this.latestDown.ask;
      update.spreadDown = this.latestDown.ask > 0 && this.latestDown.bid > 0
        ? this.latestDown.ask - this.latestDown.bid : 0;
    }
    this.dirty = false;
    this.onUpdate(update);
  }

  subscribe(clobTokenIds: string[], outcomes: string[]) {
    const tokenIds: string[] = typeof clobTokenIds === 'string'
      ? JSON.parse(clobTokenIds) : clobTokenIds;
    const labels: string[] = typeof outcomes === 'string'
      ? JSON.parse(outcomes) : outcomes;

    this.assetIds = tokenIds;

    // Map token IDs to UP/DOWN by matching outcomes labels
    const ui = labels.findIndex((l) => l.toLowerCase() === 'up');
    const di = labels.findIndex((l) => l.toLowerCase() === 'down');
    this.upTokenId = ui >= 0 ? tokenIds[ui] : tokenIds[0] ?? '';
    this.downTokenId = di >= 0 ? tokenIds[di] : tokenIds[1] ?? '';

    console.log('[PM WS] subscribe', {
      upTokenId: this.upTokenId.slice(0, 20) + '…',
      downTokenId: this.downTokenId.slice(0, 20) + '…',
      labels,
    });

    this.latestUp = null;
    this.latestDown = null;
    this.dirty = false;
    this.closeWs();
    this.connect();
  }

  private connect() {
    if (!this.alive || this.assetIds.length === 0) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/pm-ws/ws/market`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
    }

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: 'market', assets_ids: this.assetIds }));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const pc = msg.price_changes;
        if (!pc || !Array.isArray(pc)) return;

        // Each entry has its own asset_id — match against known UP/DOWN tokens
        for (const entry of pc) {
          const id = String(entry.asset_id ?? '');
          const ask = parseFloat(entry.best_ask ?? '0');
          const bid = parseFloat(entry.best_bid ?? '0');
          if (ask <= 0) continue;

          if (id === this.upTokenId) {
            this.latestUp = { ask, bid };
            this.dirty = true;
          } else if (id === this.downTokenId) {
            this.latestDown = { ask, bid };
            this.dirty = true;
          }
        }
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => { if (this.alive) this.scheduleReconnect(); };
    this.ws.onerror = () => { this.ws?.close(); };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3_000);
  }

  private closeWs() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(); this.ws = null; }
  }

  destroy() {
    this.alive = false;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.closeWs();
  }
}

// ───────────────────────────────────────────────
// Scheduler
// ───────────────────────────────────────────────

function msUntilNextWindow(): number {
  const now = Date.now();
  const windowMs = WINDOW_SEC * 1000;
  const nextBoundary = Math.ceil(now / windowMs) * windowMs;
  return nextBoundary - now + SCHEDULER_DELAY_MS;
}

// ───────────────────────────────────────────────
// Main public API
// ───────────────────────────────────────────────

export type PMCallback = (data: PolymarketData) => void;

export function initPolymarket(cb: PMCallback): () => void {
  const state: PolymarketData = { ...EMPTY_PM };
  let destroyed = false;
  let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  const emit = () => { if (!destroyed) cb({ ...state, history: [...state.history] }); };

  const wsm = new WsManager((u) => {
    if (u.priceUp !== undefined) state.priceUp = u.priceUp;
    if (u.priceDown !== undefined) state.priceDown = u.priceDown;
    if (u.spreadUp !== undefined) state.spreadUp = u.spreadUp;
    if (u.spreadDown !== undefined) state.spreadDown = u.spreadDown;
    emit();
  });

  // Countdown — updates every second
  countdownTimer = setInterval(() => {
    if (state.currentWindowTs > 0) {
      const endMs = (state.currentWindowTs + WINDOW_SEC) * 1000;
      state.secsRemaining = Math.max(0, Math.round((endMs - Date.now()) / 1000));
      emit();
    }
  }, 1_000);

  async function refresh() {
    if (destroyed) return;

    const now = new Date();
    const { current, prev } = windowTimestamps(now, HISTORY_COUNT);
    state.currentWindowTs = current;
    state.secsRemaining = Math.max(0, current + WINDOW_SEC - Math.floor(now.getTime() / 1000));

    const currentSlug = slug(current);
    const allSlugs = [currentSlug, ...prev.map(slug)];
    const events = await fetchEventsBySlugs(allSlugs);

    state.history = buildHistory(events, prev);

    const currentMarket = await fetchMarketBySlug(currentSlug);

    if (currentMarket) {
      state.question = currentMarket.question;
      state.status = 'live';
      state.statusMsg = '';

      // Parse initial prices from REST
      try {
        const prices: string[] = JSON.parse(currentMarket.outcomePrices || '[]');
        const outcomes: string[] = JSON.parse(currentMarket.outcomes || '[]');
        const upIdx = outcomes.findIndex((o) => o.toLowerCase() === 'up');
        const downIdx = outcomes.findIndex((o) => o.toLowerCase() === 'down');
        if (upIdx >= 0) state.priceUp = parseFloat(prices[upIdx]) || 0;
        if (downIdx >= 0) state.priceDown = parseFloat(prices[downIdx]) || 0;
      } catch { /* */ }

      // Subscribe WebSocket
      try {
        const tokenIds = JSON.parse(currentMarket.clobTokenIds || '[]');
        const outcomes = JSON.parse(currentMarket.outcomes || '["Up","Down"]');
        wsm.subscribe(tokenIds, outcomes);
      } catch { /* */ }
    } else {
      state.question = `Ожидание маркета: ${currentSlug}`;
      state.status = 'waiting';
      state.statusMsg = 'Маркет ещё не создан';
      state.priceUp = 0;
      state.priceDown = 0;
      state.spreadUp = 0;
      state.spreadDown = 0;
    }

    emit();
    scheduleNext();
  }

  function scheduleNext() {
    if (destroyed) return;
    schedulerTimer = setTimeout(() => refresh(), msUntilNextWindow());
  }

  refresh();

  return () => {
    destroyed = true;
    wsm.destroy();
    if (schedulerTimer) clearTimeout(schedulerTimer);
    if (countdownTimer) clearInterval(countdownTimer);
  };
}
