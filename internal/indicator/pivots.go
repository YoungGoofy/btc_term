package indicator

import (
	"github.com/YoungGoofy/btc_term/internal/binance"
)

// PivotPoint represents a detected pivot (local high or low).
type PivotPoint struct {
	Index int
	Price float64
	IsHigh bool
}

// PivotsHL calculates Pivot High/Low with the given lookback window.
type PivotsHL struct {
	Window int // number of candles on each side to confirm a pivot (10 by default)
	Highs  []float64 // NaN means no pivot at that index; value means pivot high price
	Lows   []float64 // same for pivot lows
}

// NewPivotsHL creates a new PivotsHL calculator.
func NewPivotsHL(window int) *PivotsHL {
	return &PivotsHL{Window: window}
}

// Calculate detects pivot highs and lows across the candle series.
// For each index, Highs[i] and Lows[i] are set to the pivot price if detected, else 0.
func (p *PivotsHL) Calculate(candles []binance.Candle) {
	n := len(candles)
	p.Highs = make([]float64, n)
	p.Lows = make([]float64, n)

	for i := p.Window; i < n-p.Window; i++ {
		isHigh := true
		isLow := true

		for j := i - p.Window; j <= i+p.Window; j++ {
			if j == i {
				continue
			}
			if candles[j].High >= candles[i].High {
				isHigh = false
			}
			if candles[j].Low <= candles[i].Low {
				isLow = false
			}
			if !isHigh && !isLow {
				break
			}
		}

		if isHigh {
			p.Highs[i] = candles[i].High
		}
		if isLow {
			p.Lows[i] = candles[i].Low
		}
	}
}

// Recalculate re-runs pivot detection. Called after candle array changes.
func (p *PivotsHL) Recalculate(candles []binance.Candle) {
	p.Calculate(candles)
}
