package indicator

import (
	"github.com/YoungGoofy/btc_term/internal/binance"
)

// VWAP holds the running state for incremental VWAP calculation.
type VWAP struct {
	CumTPV  float64 // cumulative (typical_price * volume)
	CumVol  float64 // cumulative volume
	Values  []float64
}

// NewVWAP creates a new VWAP calculator.
func NewVWAP() *VWAP {
	return &VWAP{}
}

// Calculate computes VWAP for the entire candle slice from scratch.
func (v *VWAP) Calculate(candles []binance.Candle) []float64 {
	v.CumTPV = 0
	v.CumVol = 0
	v.Values = make([]float64, len(candles))

	for i, c := range candles {
		tp := (c.High + c.Low + c.Close) / 3
		v.CumTPV += tp * c.Volume
		v.CumVol += c.Volume

		if v.CumVol > 0 {
			v.Values[i] = v.CumTPV / v.CumVol
		}
	}
	return v.Values
}

// Update recalculates the last VWAP value when the current (last) candle is updated in-place.
// prevCandle is the old version of the last candle; newCandle is the updated version.
func (v *VWAP) Update(prevCandle, newCandle binance.Candle) float64 {
	// Remove previous contribution.
	oldTP := (prevCandle.High + prevCandle.Low + prevCandle.Close) / 3
	v.CumTPV -= oldTP * prevCandle.Volume
	v.CumVol -= prevCandle.Volume

	// Add new contribution.
	newTP := (newCandle.High + newCandle.Low + newCandle.Close) / 3
	v.CumTPV += newTP * newCandle.Volume
	v.CumVol += newCandle.Volume

	val := 0.0
	if v.CumVol > 0 {
		val = v.CumTPV / v.CumVol
	}
	if len(v.Values) > 0 {
		v.Values[len(v.Values)-1] = val
	}
	return val
}

// AddNew adds a freshly closed candle to the running VWAP.
func (v *VWAP) AddNew(c binance.Candle) float64 {
	tp := (c.High + c.Low + c.Close) / 3
	v.CumTPV += tp * c.Volume
	v.CumVol += c.Volume

	val := 0.0
	if v.CumVol > 0 {
		val = v.CumTPV / v.CumVol
	}
	v.Values = append(v.Values, val)
	return val
}
