package indicator

// MACDResult holds the output of a MACD calculation.
type MACDResult struct {
	MACD      []float64 // MACD line (EMA12 - EMA26)
	Signal    []float64 // Signal line (EMA9 of MACD)
	Histogram []float64 // MACD - Signal
}

// MACDCalc holds the state for incremental MACD calculation.
type MACDCalc struct {
	ema12  *EMA
	ema26  *EMA
	signal *EMA
	Result MACDResult
}

// NewMACD creates a new MACD calculator with standard parameters (12, 26, 9).
func NewMACD() *MACDCalc {
	return &MACDCalc{
		ema12:  NewEMA(12),
		ema26:  NewEMA(26),
		signal: NewEMA(9),
	}
}

// Calculate computes MACD, Signal, and Histogram for the given close prices.
func (m *MACDCalc) Calculate(closes []float64) MACDResult {
	ema12Vals := m.ema12.Calculate(closes)
	ema26Vals := m.ema26.Calculate(closes)

	n := len(closes)
	macdLine := make([]float64, n)
	for i := 0; i < n; i++ {
		macdLine[i] = ema12Vals[i] - ema26Vals[i]
	}

	signalVals := m.signal.Calculate(macdLine)

	hist := make([]float64, n)
	for i := 0; i < n; i++ {
		hist[i] = macdLine[i] - signalVals[i]
	}

	m.Result = MACDResult{
		MACD:      macdLine,
		Signal:    signalVals,
		Histogram: hist,
	}
	return m.Result
}

// Update recalculates the last MACD values for an in-place candle update.
func (m *MACDCalc) Update(close float64) {
	e12 := m.ema12.Update(close)
	e26 := m.ema26.Update(close)
	macdVal := e12 - e26
	sigVal := m.signal.Update(macdVal)
	histVal := macdVal - sigVal

	n := len(m.Result.MACD)
	if n > 0 {
		m.Result.MACD[n-1] = macdVal
		m.Result.Signal[n-1] = sigVal
		m.Result.Histogram[n-1] = histVal
	}
}

// AddNew appends new MACD values for a newly closed candle.
func (m *MACDCalc) AddNew(close float64) {
	e12 := m.ema12.AddNew(close)
	e26 := m.ema26.AddNew(close)
	macdVal := e12 - e26
	sigVal := m.signal.AddNew(macdVal)
	histVal := macdVal - sigVal

	m.Result.MACD = append(m.Result.MACD, macdVal)
	m.Result.Signal = append(m.Result.Signal, sigVal)
	m.Result.Histogram = append(m.Result.Histogram, histVal)
}
