package indicator

// RSICalc holds the state for incremental RSI calculation using Wilder's smoothing.
type RSICalc struct {
	Period  int
	AvgGain float64
	AvgLoss float64
	Prev    float64
	Values  []float64
	count   int
}

// NewRSI creates a new RSI calculator with the given period.
func NewRSI(period int) *RSICalc {
	return &RSICalc{Period: period}
}

// Calculate computes RSI values for the given close prices using Wilder's smoothing.
func (r *RSICalc) Calculate(closes []float64) []float64 {
	n := len(closes)
	r.Values = make([]float64, n)
	r.count = 0

	if n <= r.Period {
		for i := range r.Values {
			r.Values[i] = 50 // neutral when not enough data
		}
		if n > 0 {
			r.Prev = closes[n-1]
		}
		return r.Values
	}

	// First `period` changes to calculate initial average gain/loss.
	sumGain := 0.0
	sumLoss := 0.0
	for i := 1; i <= r.Period; i++ {
		change := closes[i] - closes[i-1]
		if change > 0 {
			sumGain += change
		} else {
			sumLoss -= change // make positive
		}
		r.Values[i] = 50 // not enough data yet
	}

	r.AvgGain = sumGain / float64(r.Period)
	r.AvgLoss = sumLoss / float64(r.Period)

	if r.AvgLoss == 0 {
		r.Values[r.Period] = 100
	} else {
		rs := r.AvgGain / r.AvgLoss
		r.Values[r.Period] = 100 - 100/(1+rs)
	}

	// Wilder's smoothing for subsequent values.
	for i := r.Period + 1; i < n; i++ {
		change := closes[i] - closes[i-1]
		gain := 0.0
		loss := 0.0
		if change > 0 {
			gain = change
		} else {
			loss = -change
		}

		r.AvgGain = (r.AvgGain*float64(r.Period-1) + gain) / float64(r.Period)
		r.AvgLoss = (r.AvgLoss*float64(r.Period-1) + loss) / float64(r.Period)

		if r.AvgLoss == 0 {
			r.Values[i] = 100
		} else {
			rs := r.AvgGain / r.AvgLoss
			r.Values[i] = 100 - 100/(1+rs)
		}
	}

	r.Prev = closes[n-1]
	r.count = n
	return r.Values
}

// Update recalculates the last RSI value when the current candle is updated in-place.
// prevClose is the close of the candle before the last one.
func (r *RSICalc) Update(prevClose, newClose float64) float64 {
	change := newClose - prevClose
	gain := 0.0
	loss := 0.0
	if change > 0 {
		gain = change
	} else {
		loss = -change
	}

	// We need to recompute from saved state. Since Update replaces the last value,
	// we temporarily use the second-to-last avg values.
	// For simplicity, just recompute using current avgs (approximate for live updates).
	avgGain := (r.AvgGain*float64(r.Period-1) + gain) / float64(r.Period)
	avgLoss := (r.AvgLoss*float64(r.Period-1) + loss) / float64(r.Period)

	var rsi float64
	if avgLoss == 0 {
		rsi = 100
	} else {
		rs := avgGain / avgLoss
		rsi = 100 - 100/(1+rs)
	}

	if len(r.Values) > 0 {
		r.Values[len(r.Values)-1] = rsi
	}
	return rsi
}

// AddNew appends a new RSI value for a newly closed candle.
func (r *RSICalc) AddNew(close float64) float64 {
	change := close - r.Prev
	gain := 0.0
	loss := 0.0
	if change > 0 {
		gain = change
	} else {
		loss = -change
	}

	r.AvgGain = (r.AvgGain*float64(r.Period-1) + gain) / float64(r.Period)
	r.AvgLoss = (r.AvgLoss*float64(r.Period-1) + loss) / float64(r.Period)

	var rsi float64
	if r.AvgLoss == 0 {
		rsi = 100
	} else {
		rs := r.AvgGain / r.AvgLoss
		rsi = 100 - 100/(1+rs)
	}

	r.Prev = close
	r.Values = append(r.Values, rsi)
	return rsi
}
