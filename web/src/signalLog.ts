/**
 * Signal Logger — логирование предсказаний AI ассистента
 * Данные хранятся в localStorage и не теряются при перезагрузке.
 * Формат: читаемый и для человека, и для AI-анализа.
 */

import type { SmartVerdict } from './smartAlg';
import type { PolymarketData } from './polymarket';

export interface IndicatorSnapshot {
  rsi: number;
  macdHist: number;
  macdCross: number;
  vwap: number;
  ema: number;
  pivots: number;
  ha: number;
  threeCandle: number;
  stochRSI: number;
  bb: number;
  atrValue: number;
  atrMode: string;
  mtf: Record<string, string>;
}

export interface SignalLogEntry {
  id: string;
  timestamp: string;           // ISO string
  windowTs: number;            // PM window start timestamp
  windowTime: string;          // Human-readable "15:30"
  action: string;              // ВХОД UP / ВХОД DOWN
  direction: string;           // UP / DOWN
  confidence: number;          // 0-1
  votes: { up: number; down: number; neutral: number };
  coreVotes: Record<string, number>; // per-indicator vote
  momentumUp: number;
  momentumDown: number;
  
  // Indicator values at entry
  entryIndicators: IndicatorSnapshot;
  
  // PM data at entry
  pmPriceUp: number;
  pmPriceDown: number;
  pmSecsRemaining: number;
  
  // Conflicts/reasons
  conflicts: string[];

  // Result (filled later)
  result?: 'win' | 'loss' | 'pending';
  resultTimestamp?: string;
  
  // Indicator values at close (filled later)
  closeIndicators?: IndicatorSnapshot;
  closePmPriceUp?: number;
  closePmPriceDown?: number;
}

const STORAGE_KEY = 'btc_term_signal_log';
const MAX_ENTRIES = 200;

// ─── CRUD ─────────────────────────────────

export function getLogEntries(): SignalLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SignalLogEntry[];
  } catch {
    return [];
  }
}

function saveLogEntries(entries: SignalLogEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  
  // АВТОСОХРАНЕНИЕ: Отправляем полный отформатированный лог через локальный Vite plugin
  setTimeout(() => {
    fetch('/api/save-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: exportLogAsText(), overwrite: true })
    }).catch(err => console.error('[SignalLog] Auto-save failed:', err));
  }, 100);
}

export function logSignalEntry(
  verdict: SmartVerdict,
  pmData: PolymarketData,
): void {
  if (!verdict.action.startsWith('ВХОД')) return;

  const entries = getLogEntries();

  // Don't duplicate — check if this window already has an entry
  if (entries.some(e => e.windowTs === pmData.currentWindowTs)) return;

  const now = new Date();
  const windowTime = new Date(pmData.currentWindowTs * 1000)
    .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const entry: SignalLogEntry = {
    id: `${pmData.currentWindowTs}_${Date.now()}`,
    timestamp: now.toISOString(),
    windowTs: pmData.currentWindowTs,
    windowTime,
    action: verdict.action,
    direction: verdict.direction,
    confidence: verdict.confidence,
    votes: verdict.voteCounts,
    coreVotes: verdict.coreVotes as any,
    momentumUp: 0,  // filled from factors
    momentumDown: 0,
    entryIndicators: extractIndicators(verdict),
    pmPriceUp: pmData.priceUp,
    pmPriceDown: pmData.priceDown,
    pmSecsRemaining: pmData.secsRemaining,
    conflicts: verdict.factors.conflicts || [],
    result: 'pending',
  };

  entries.unshift(entry);
  saveLogEntries(entries);
  console.log('[SignalLog] Entry logged:', entry.windowTime, entry.action);
}

export function logSignalResult(
  windowTs: number,
  result: 'win' | 'loss',
  verdict: SmartVerdict | null,
  pmData: PolymarketData,
): void {
  const entries = getLogEntries();
  const idx = entries.findIndex(e => e.windowTs === windowTs && e.result === 'pending');
  if (idx === -1) return;

  entries[idx].result = result;
  entries[idx].resultTimestamp = new Date().toISOString();
  entries[idx].closePmPriceUp = pmData.priceUp;
  entries[idx].closePmPriceDown = pmData.priceDown;

  if (verdict) {
    entries[idx].closeIndicators = extractIndicators(verdict);
  }

  saveLogEntries(entries);
  console.log('[SignalLog] Result logged:', entries[idx].windowTime, result);
}

function extractIndicators(v: SmartVerdict): IndicatorSnapshot {
  return {
    rsi: v.factors.rsi?.rawValue ?? 0,
    macdHist: v.factors.macd?.weight ?? 0,
    macdCross: v.factors.macdCrossover?.weight ?? 0,
    vwap: v.factors.vwap?.weight ?? 0,
    ema: v.factors.ema?.weight ?? 0,
    pivots: v.factors.pivots?.weight ?? 0,
    ha: v.factors.ha?.weight ?? 0,
    threeCandle: v.factors.threeCandle?.weight ?? 0,
    stochRSI: v.factors.stoch?.rawValue ?? 0,
    bb: v.factors.bb?.weight ?? 0,
    atrValue: v.factors.atr?.weight ?? 0,
    atrMode: v.atrMode,
    mtf: v.mtfStatus as any,
  };
}

// ─── Export as readable text file ─────────────────────────────────

export function exportLogAsText(): string {
  const entries = getLogEntries();
  if (entries.length === 0) return '# Signal Log — пусто\n';

  const lines: string[] = [];
  lines.push('# 📋 BTC Terminal — Signal Log');
  lines.push(`# Экспорт: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`# Всего записей: ${entries.length}`);
  
  const wins = entries.filter(e => e.result === 'win').length;
  const losses = entries.filter(e => e.result === 'loss').length;
  const pending = entries.filter(e => e.result === 'pending').length;
  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '—';
  
  lines.push(`# Winrate: ${wr}% (${wins}W / ${losses}L / ${pending}P)`);
  lines.push('');
  lines.push('═'.repeat(70));

  for (const e of entries) {
    lines.push('');
    lines.push('═'.repeat(70));
    lines.push(`📅 ${e.timestamp.slice(0, 19).replace('T', ' ')} | Окно: ${e.windowTime}`);
    lines.push('─'.repeat(70));
    lines.push('');
    lines.push(`🎯 ${e.action} | Уверенность: ${Math.round(e.confidence * 100)}%`);
    lines.push(`📊 Голоса: ▲${e.votes.up} / ▼${e.votes.down} / —${e.votes.neutral}`);
    
    if (e.coreVotes) {
      const voteStr = Object.entries(e.coreVotes)
        .map(([k, v]) => `${k}: ${v > 0 ? '▲' : v < 0 ? '▼' : '—'}`)
        .join(' | ');
      lines.push(`   ${voteStr}`);
    }
    
    lines.push('');
    lines.push('── Индикаторы при входе ──');
    const ind = e.entryIndicators;
    lines.push(`  RSI:          ${ind.rsi.toFixed(1)}`);
    lines.push(`  MACD Hist:    ${ind.macdHist.toFixed(3)}`);
    lines.push(`  MACD Cross:   ${ind.macdCross.toFixed(3)}`);
    lines.push(`  VWAP:         ${ind.vwap.toFixed(3)}`);
    lines.push(`  EMA:          ${ind.ema.toFixed(3)}`);
    lines.push(`  Pivots:       ${ind.pivots.toFixed(3)}`);
    lines.push(`  HA:           ${ind.ha.toFixed(3)}`);
    lines.push(`  3Candle:      ${ind.threeCandle.toFixed(3)}`);
    lines.push(`  StochRSI:     ${ind.stochRSI.toFixed(0)}`);
    lines.push(`  BB:           ${ind.bb.toFixed(3)}`);
    lines.push(`  ATR:          ${ind.atrMode} (weight: ${ind.atrValue.toFixed(2)})`);
    
    if (ind.mtf) {
      lines.push(`  MTF:          1m:${ind.mtf['1m']} 5m:${ind.mtf['5m']} 15m:${ind.mtf['15m']} 4h:${ind.mtf['4h']}`);
    }

    lines.push('');
    lines.push('── PM Data ──');
    lines.push(`  UP: ${(e.pmPriceUp * 100).toFixed(1)}¢ | DOWN: ${(e.pmPriceDown * 100).toFixed(1)}¢ | Осталось: ${Math.floor(e.pmSecsRemaining / 60)}:${String(e.pmSecsRemaining % 60).padStart(2, '0')}`);

    if (e.conflicts && e.conflicts.length > 0) {
      lines.push('');
      lines.push('── Конфликты ──');
      for (const c of e.conflicts) {
        lines.push(`  ⚠ ${c}`);
      }
    }

    // Result
    lines.push('');
    if (e.result === 'win') {
      lines.push(`═══ ✅ РЕЗУЛЬТАТ: WIN ═══`);
    } else if (e.result === 'loss') {
      lines.push(`═══ ❌ РЕЗУЛЬТАТ: LOSS ═══`);
    } else {
      lines.push(`═══ ⏳ РЕЗУЛЬТАТ: PENDING ═══`);
    }

    if (e.resultTimestamp) {
      lines.push(`  Время: ${e.resultTimestamp.slice(0, 19).replace('T', ' ')}`);
    }
    if (e.closePmPriceUp != null) {
      lines.push(`  PM Close: UP ${(e.closePmPriceUp * 100).toFixed(1)}¢ | DOWN ${((e.closePmPriceDown ?? 0) * 100).toFixed(1)}¢`);
    }
    if (e.closeIndicators) {
      const ci = e.closeIndicators;
      lines.push('  ── Индикаторы при закрытии ──');
      lines.push(`  RSI:${ci.rsi.toFixed(1)} MACD:${ci.macdHist.toFixed(3)} VWAP:${ci.vwap.toFixed(3)} EMA:${ci.ema.toFixed(3)} HA:${ci.ha.toFixed(3)} Stoch:${ci.stochRSI.toFixed(0)}`);
    }
    
    lines.push('═'.repeat(70));
  }

  lines.push('');
  lines.push('# === END OF LOG ===');
  return lines.join('\n');
}

export function downloadLog(): void {
  const text = exportLogAsText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signal_log_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
