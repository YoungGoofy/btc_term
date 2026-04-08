package indicator

import (
	"github.com/YoungGoofy/btc_term/internal/binance"
)

// ConvertToHA converts a slice of regular candles to Heikin Ashi candles.
func ConvertToHA(candles []binance.Candle) []binance.Candle {
	if len(candles) == 0 {
		return nil
	}

	ha := make([]binance.Candle, len(candles))

	// First HA candle: use average of first regular candle.
	c := candles[0]
	ha[0] = binance.Candle{
		OpenTime: c.OpenTime,
		Open:     (c.Open + c.Close) / 2,
		Close:    (c.Open + c.High + c.Low + c.Close) / 4,
		High:     c.High,
		Low:      c.Low,
		Volume:   c.Volume,
	}

	for i := 1; i < len(candles); i++ {
		ha[i] = computeHA(ha[i-1], candles[i])
	}
	return ha
}

// UpdateLastHA computes a new HA candle given the previous HA and a new regular candle.
func UpdateLastHA(prevHA, current binance.Candle) binance.Candle {
	return computeHA(prevHA, current)
}

func computeHA(prevHA, c binance.Candle) binance.Candle {
	haClose := (c.Open + c.High + c.Low + c.Close) / 4
	haOpen := (prevHA.Open + prevHA.Close) / 2
	haHigh := max3(c.High, haOpen, haClose)
	haLow := min3(c.Low, haOpen, haClose)

	return binance.Candle{
		OpenTime: c.OpenTime,
		Open:     haOpen,
		Close:    haClose,
		High:     haHigh,
		Low:      haLow,
		Volume:   c.Volume,
	}
}

func max3(a, b, c float64) float64 {
	m := a
	if b > m {
		m = b
	}
	if c > m {
		m = c
	}
	return m
}

func min3(a, b, c float64) float64 {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}
