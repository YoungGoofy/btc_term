import { fetchKlines, connectWS } from './api';
import type { BinanceWsInstance } from './api';
import { computeAll, computeLastOnly } from './indicators';
import type { ComputedData } from './indicators';
import type { Candle } from './types';

export type MTFRecord = Record<string, ComputedData | null>;

const MAX_CACHE_SIZE = 5000;

export class MTFManager {
  public computed: MTFRecord = { '1m': null, '5m': null, '15m': null, '4h': null };
  private candles: Record<string, Candle[]> = { '1m': [], '5m': [], '15m': [], '4h': [] };
  private sockets: BinanceWsInstance[] = [];
  private onUpdateCallback: ((updatedTf: string, data: MTFRecord) => void) | null = null;
  private started = false;

  constructor(public symbol: string) {}

  public onUpdate(cb: (updatedTf: string, data: MTFRecord) => void) {
    this.onUpdateCallback = cb;
  }

  public start() {
    if (this.started) return;
    this.started = true;
    
    const tfs = ['1m', '5m', '15m', '4h'];
    tfs.forEach(async (tf) => {
      try {
        const c = await fetchKlines(this.symbol, tf, 500);
        this.candles[tf] = c;
        this.computed[tf] = computeAll(c);
        if (this.onUpdateCallback) {
          this.onUpdateCallback(tf, { ...this.computed });
        }
      } catch (e) {
        console.error(`MTF REST error for ${tf}:`, e);
      }
      
      const ws = connectWS(this.symbol, tf, (tick, isClosed) => {
        let arr = this.candles[tf];
        if (arr.length > 0 && arr[arr.length - 1].time === tick.time) {
          arr[arr.length - 1] = tick;
        } else {
          arr.push(tick);
          if (arr.length > MAX_CACHE_SIZE) {
            this.candles[tf] = arr.slice(-MAX_CACHE_SIZE);
            arr = this.candles[tf];
          }
        }

        // Full recompute only on candle close; lightweight update on ticks
        const prev = this.computed[tf];
        if (isClosed || !prev) {
          this.computed[tf] = computeAll(arr);
        } else {
          this.computed[tf] = computeLastOnly(arr, prev);
        }
        
        if (this.onUpdateCallback) {
          this.onUpdateCallback(tf, { ...this.computed });
        }
      });
      this.sockets.push(ws);
    });
  }

  public stop() {
    this.sockets.forEach(s => s.close());
    this.sockets = [];
    this.started = false;
  }
}
