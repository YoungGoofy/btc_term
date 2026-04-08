package chart

import (
	"math"
)

// RenderSmoothLine draws a continuous, thick, anti-aliased line on the canvas.
// Uses cubic interpolation between data points for smoothness, then draws with
// vertical spread for thickness. Each value maps to one candle's center X position.
func RenderSmoothLine(canvas *Canvas, values []float64, yMin, yMax float64, color string, thickness int) {
	if len(values) < 2 || yMax <= yMin {
		return
	}

	ph := canvas.PixelHeight()
	stride := CandleStride()
	half := thickness / 2

	scaleY := func(val float64) float64 {
		ratio := (val - yMin) / (yMax - yMin)
		return float64(ph-1) * (1.0 - ratio)
	}

	// For each sub-pixel x column between data points, interpolate y smoothly.
	totalPx := (len(values) - 1) * stride
	prevPy := -1

	for px := 0; px <= totalPx; px++ {
		// Which data segment are we in?
		fIdx := float64(px) / float64(stride)
		idx := int(fIdx)
		t := fIdx - float64(idx)

		if idx >= len(values)-1 {
			idx = len(values) - 2
			t = 1.0
		}

		// Catmull-Rom spline interpolation for smoothness.
		p0 := safeGet(values, idx-1)
		p1 := values[idx]
		p2 := values[idx+1]
		p3 := safeGet(values, idx+2)

		if p1 == 0 && p2 == 0 {
			continue
		}

		interpolated := catmullRom(p0, p1, p2, p3, t)
		py := int(scaleY(interpolated))
		py = clamp(py, 0, ph-1)

		// Draw vertical spread for thickness.
		for d := -half; d <= half; d++ {
			dpy := py + d
			if dpy >= 0 && dpy < ph {
				canvas.SetColor(px, dpy, color)
			}
		}

		// Fill gap between previous and current y if there's a large jump.
		if prevPy >= 0 && iabs(py-prevPy) > 1 {
			yStart, yEnd := prevPy, py
			if yStart > yEnd {
				yStart, yEnd = yEnd, yStart
			}
			for fy := yStart; fy <= yEnd; fy++ {
				for d := -half; d <= half; d++ {
					dfy := fy + d
					if dfy >= 0 && dfy < ph {
						canvas.SetColor(px, dfy, color)
					}
				}
			}
		}

		prevPy = py
	}
}

// RenderPivots draws diamond-shaped pivot markers.
func RenderPivots(canvas *Canvas, highs, lows []float64, yMin, yMax float64) {
	if yMax <= yMin {
		return
	}

	ph := canvas.PixelHeight()
	stride := CandleStride()

	scaleY := func(val float64) int {
		ratio := (val - yMin) / (yMax - yMin)
		py := int(float64(ph-1) * (1.0 - ratio))
		return clamp(py, 0, ph-1)
	}

	// Diamond marker: 3×3 sub-pixels.
	drawDiamond := func(cx, cy int, color string) {
		canvas.SetColor(cx, cy, color)
		canvas.SetColor(cx-1, cy, color)
		canvas.SetColor(cx+1, cy, color)
		canvas.SetColor(cx, cy-1, color)
		canvas.SetColor(cx, cy+1, color)
	}

	for i, h := range highs {
		if h > 0 {
			x := i*stride + candleBodyW/2
			y := scaleY(h) - 2 // slightly above the high
			drawDiamond(x, y, ColPivotHi)
		}
	}

	for i, l := range lows {
		if l > 0 {
			x := i*stride + candleBodyW/2
			y := scaleY(l) + 2 // slightly below the low
			drawDiamond(x, y, ColPivotLo)
		}
	}
}

// ValueBounds returns (min, max) of non-zero values with a margin.
func ValueBounds(values ...[]float64) (float64, float64) {
	first := true
	var yMin, yMax float64

	for _, vals := range values {
		for _, v := range vals {
			if v == 0 {
				continue
			}
			if first {
				yMin = v
				yMax = v
				first = false
				continue
			}
			if v < yMin {
				yMin = v
			}
			if v > yMax {
				yMax = v
			}
		}
	}

	if first {
		return 0, 1
	}

	margin := (yMax - yMin) * 0.05
	if margin == 0 {
		margin = 1
	}
	return yMin - margin, yMax + margin
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// catmullRom performs Catmull-Rom spline interpolation with tension 0.5.
func catmullRom(p0, p1, p2, p3, t float64) float64 {
	t2 := t * t
	t3 := t2 * t
	return 0.5 * ((2 * p1) +
		(-p0+p2)*t +
		(2*p0-5*p1+4*p2-p3)*t2 +
		(-p0+3*p1-3*p2+p3)*t3)
}

// safeGet returns values[i] clamped to array bounds.
func safeGet(values []float64, i int) float64 {
	if i < 0 {
		return values[0]
	}
	if i >= len(values) {
		return values[len(values)-1]
	}
	return values[i]
}

// DrawHLine draws a dashed horizontal reference line at the given Y value.
func DrawHLine(canvas *Canvas, val, yMin, yMax float64, color string) {
	if yMax <= yMin {
		return
	}
	ph := canvas.PixelHeight()
	ratio := (val - yMin) / (yMax - yMin)
	py := int(float64(ph-1) * (1.0 - ratio))
	if py < 0 || py >= ph {
		return
	}
	// Dashed pattern: 2 on, 3 off.
	for px := 0; px < canvas.PixelWidth(); px++ {
		if px%5 < 2 {
			canvas.SetColor(px, py, color)
		}
	}
}

// DrawRSIZones fills background color for the overbought (70-100) and
// oversold (0-30) zones of an RSI chart.
func DrawRSIZones(canvas *Canvas, yMin, yMax float64, zoneColor string) {
	if yMax <= yMin {
		return
	}
	ph := canvas.PixelHeight()

	scaleToCell := func(val float64) int {
		ratio := (val - yMin) / (yMax - yMin)
		py := float64(ph-1) * (1.0 - ratio)
		return int(math.Round(py)) / 4 // convert sub-pixel → cell row
	}

	// Overbought zone: 70 → 100.
	ob0 := scaleToCell(100)
	ob1 := scaleToCell(70)
	canvas.FillZone(ob0, ob1, zoneColor)

	// Oversold zone: 0 → 30.
	os0 := scaleToCell(30)
	os1 := scaleToCell(0)
	canvas.FillZone(os0, os1, zoneColor)
}
