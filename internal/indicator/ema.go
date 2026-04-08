package indicator

// EMA holds the state for an Exponential Moving Average.
type EMA struct {
	Period int
	K      float64 // smoothing factor: 2 / (period + 1)
	Last   float64
	Values []float64
	ready  bool
}

// NewEMA creates a new EMA calculator with the given period.
func NewEMA(period int) *EMA {
	return &EMA{
		Period: period,
		K:      2.0 / float64(period+1),
	}
}

// Calculate computes EMA values for the given close prices.
func (e *EMA) Calculate(closes []float64) []float64 {
	n := len(closes)
	e.Values = make([]float64, n)

	if n == 0 {
		return e.Values
	}

	// SMA for the initial period.
	if n < e.Period {
		// Not enough data for a full period; use a running SMA.
		sum := 0.0
		for i, c := range closes {
			sum += c
			e.Values[i] = sum / float64(i+1)
		}
		e.Last = e.Values[n-1]
		e.ready = false
		return e.Values
	}

	// SMA of first `period` values.
	sum := 0.0
	for i := 0; i < e.Period; i++ {
		sum += closes[i]
		e.Values[i] = 0 // no valid EMA yet
	}
	e.Values[e.Period-1] = sum / float64(e.Period)

	// EMA from period onward.
	for i := e.Period; i < n; i++ {
		e.Values[i] = closes[i]*e.K + e.Values[i-1]*(1-e.K)
	}

	e.Last = e.Values[n-1]
	e.ready = true
	return e.Values
}

// Update recalculates the last EMA value for an in-place candle update.
func (e *EMA) Update(close float64) float64 {
	if !e.ready {
		e.Last = close
	} else {
		// Recompute from the second-to-last EMA.
		prevEMA := e.Last
		if len(e.Values) >= 2 {
			prevEMA = e.Values[len(e.Values)-2]
		}
		e.Last = close*e.K + prevEMA*(1-e.K)
	}
	if len(e.Values) > 0 {
		e.Values[len(e.Values)-1] = e.Last
	}
	return e.Last
}

// AddNew appends a new EMA value for a newly closed candle.
func (e *EMA) AddNew(close float64) float64 {
	ema := close*e.K + e.Last*(1-e.K)
	e.Last = ema
	e.Values = append(e.Values, ema)
	e.ready = true
	return ema
}
