package chart

import (
	"github.com/YoungGoofy/btc_term/internal/binance"
)

// Candle stride: 4px body + 1px wick center (drawn at body center) + 1px gap = 6px per candle.
const (
	candleBodyW = 4  // sub-pixel columns for the body
	candleStride = 6 // total sub-pixel columns per candle (body + gap)
)

// RenderCandles draws Heikin Ashi candles as solid filled rectangles with thin wicks.
func RenderCandles(canvas *Canvas, candles []binance.Candle, yMin, yMax float64) {
	if len(candles) == 0 || yMax <= yMin {
		return
	}

	ph := canvas.PixelHeight()

	scaleY := func(price float64) int {
		ratio := (price - yMin) / (yMax - yMin)
		py := int(float64(ph-1) * (1.0 - ratio))
		return clamp(py, 0, ph-1)
	}

	for i, c := range candles {
		bullish := c.Close >= c.Open

		// Pick colors.
		bodyCol := ColCandleDown
		wickCol := ColWickDown
		if bullish {
			bodyCol = ColCandleUp
			wickCol = ColWickUp
		}

		// X positions.
		xLeft := i * candleStride
		xRight := xLeft + candleBodyW - 1
		wickX := xLeft + candleBodyW/2 // center of body

		// Y positions.
		highY := scaleY(c.High)
		lowY := scaleY(c.Low)
		openY := scaleY(c.Open)
		closeY := scaleY(c.Close)

		bodyTop := openY
		bodyBot := closeY
		if bodyTop > bodyBot {
			bodyTop, bodyBot = bodyBot, bodyTop
		}
		// Ensure body is at least 1 sub-pixel tall.
		if bodyTop == bodyBot {
			if bodyBot < ph-1 {
				bodyBot++
			} else {
				bodyTop--
			}
		}

		// 1. Draw upper wick (high → body top).
		if highY < bodyTop {
			canvas.VLine(wickX, highY, bodyTop-1, wickCol)
		}

		// 2. Draw solid body (filled rectangle).
		canvas.FillRect(xLeft, bodyTop, xRight, bodyBot, bodyCol)

		// 3. Draw lower wick (body bottom → low).
		if lowY > bodyBot {
			canvas.VLine(wickX, bodyBot+1, lowY, wickCol)
		}
	}
}

// CandlesBounds returns min/max with margin for a visible candle slice.
func CandlesBounds(candles []binance.Candle) (float64, float64) {
	if len(candles) == 0 {
		return 0, 1
	}
	yMin := candles[0].Low
	yMax := candles[0].High
	for _, c := range candles[1:] {
		if c.Low < yMin {
			yMin = c.Low
		}
		if c.High > yMax {
			yMax = c.High
		}
	}
	margin := (yMax - yMin) * 0.03
	if margin == 0 {
		margin = 1
	}
	return yMin - margin, yMax + margin
}

// VisibleCandles returns the latest candles that fit in the given pixel width.
func VisibleCandles(candles []binance.Candle, pixelWidth int) []binance.Candle {
	max := pixelWidth / candleStride
	if max < 1 {
		max = 1
	}
	if len(candles) > max {
		return candles[len(candles)-max:]
	}
	return candles
}

// CandleStride returns the stride used by the candle renderer (for line sync).
func CandleStride() int {
	return candleStride
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
