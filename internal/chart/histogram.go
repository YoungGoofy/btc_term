package chart

// RenderHistogram draws solid filled vertical bars from the zero line.
// Each bar fills the full candle body width for a dense, TradingView-like appearance.
func RenderHistogram(canvas *Canvas, values []float64, yMin, yMax float64) {
	if len(values) == 0 || yMax <= yMin {
		return
	}

	ph := canvas.PixelHeight()
	stride := CandleStride()

	scaleY := func(val float64) int {
		ratio := (val - yMin) / (yMax - yMin)
		py := int(float64(ph-1) * (1.0 - ratio))
		return clamp(py, 0, ph-1)
	}

	zeroY := scaleY(0)

	for i, v := range values {
		xLeft := i * stride
		xRight := xLeft + candleBodyW - 1
		y := scaleY(v)

		// Choose color based on value AND direction for TradingView style.
		color := ColCandleUp
		if v < 0 {
			color = ColCandleDown
		}

		// Fill rectangle from zero line to value.
		if y < zeroY {
			canvas.FillRect(xLeft, y, xRight, zeroY, color)
		} else if y > zeroY {
			canvas.FillRect(xLeft, zeroY, xRight, y, color)
		} else {
			// Exactly zero — draw a single row.
			canvas.FillRect(xLeft, zeroY, xRight, zeroY, color)
		}
	}
}

// HistogramBounds returns symmetric bounds centered on zero.
func HistogramBounds(values []float64) (float64, float64) {
	if len(values) == 0 {
		return -1, 1
	}

	maxAbs := 0.0
	for _, v := range values {
		a := v
		if a < 0 {
			a = -a
		}
		if a > maxAbs {
			maxAbs = a
		}
	}

	if maxAbs == 0 {
		maxAbs = 1
	}

	margin := maxAbs * 0.1
	return -(maxAbs + margin), maxAbs + margin
}
