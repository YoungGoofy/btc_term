package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/YoungGoofy/btc_term/internal/binance"
	"github.com/YoungGoofy/btc_term/internal/chart"
	"github.com/YoungGoofy/btc_term/internal/indicator"
)

// LayoutData contains all data needed to render the full UI.
type LayoutData struct {
	Width        int
	Height       int
	HACandles    []binance.Candle
	VWAPValues   []float64
	EMA9Values   []float64
	EMA21Values  []float64
	MACDResult   indicator.MACDResult
	RSIValues    []float64
	PivotHighs   []float64
	PivotLows    []float64
	Interval     string
	ErrMsg       string
	TickCount    int
	CurrentPrice float64
}

// ──────────────────────────────────────────────
// TradingView dark theme via lipgloss
// ──────────────────────────────────────────────

var (
	bgDark     = lipgloss.Color("#131722") // TradingView dark bg
	borderDim  = lipgloss.Color("#363A45") // panel border
	textDim    = lipgloss.Color("#787B86") // dim labels
	textBright = lipgloss.Color("#D1D4DC") // bright text
	accentGold = lipgloss.Color("#F0B90B") // Binance gold accent

	panelStyle = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderDim)

	headerStyle = lipgloss.NewStyle().
		Foreground(textBright).
		Bold(true)

	intervalBadge = lipgloss.NewStyle().
		Foreground(accentGold).
		Bold(true)

	errStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#EF5350"))

	panelTitleStyle = lipgloss.NewStyle().
		Foreground(textDim).
		Italic(true)

	axisLabelStyle = lipgloss.NewStyle().
		Foreground(textDim)

	// Legend label colors matching indicator colors.
	legendVWAP  = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF9800")).Bold(true)
	legendEMA9  = lipgloss.NewStyle().Foreground(lipgloss.Color("#2196F3")).Bold(true)
	legendEMA21 = lipgloss.NewStyle().Foreground(lipgloss.Color("#9C27B0")).Bold(true)
	legendMACD  = lipgloss.NewStyle().Foreground(lipgloss.Color("#2196F3")).Bold(true)
	legendSig   = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF9800")).Bold(true)
	legendRSI   = lipgloss.NewStyle().Foreground(lipgloss.Color("#E040FB")).Bold(true)
	legendPivot = lipgloss.NewStyle().Foreground(lipgloss.Color("#F48FB1")).Bold(true)
)

// ──────────────────────────────────────────────
// Main layout
// ──────────────────────────────────────────────

// RenderLayout assembles the three-panel vertical layout.
func RenderLayout(d LayoutData) string {
	if d.Width < 20 || d.Height < 14 {
		return "Terminal too small"
	}

	// Available height for chart drawing areas only.
	// Budget: 1 (header) + 3 panels × (2 border + 1 title) = 10 lines of chrome.
	chromeH := 1 + 3*3 // header + 3×(border+title)
	usable := d.Height - chromeH
	if usable < 6 {
		usable = 6
	}

	// Chart drawing heights (no title/border — those are added by panelStyle).
	p1H := usable * 50 / 100
	p2H := usable * 25 / 100
	p3H := usable - p1H - p2H

	p1H = maxInt(p1H, 3)
	p2H = maxInt(p2H, 2)
	p3H = maxInt(p3H, 2)

	innerW := d.Width - 4 // border chrome
	innerW = maxInt(innerW, 20)
	axisW := 10 // Y-axis label width
	chartW := innerW - axisW
	chartW = maxInt(chartW, 12)

	// === Panels ===
	panel1 := renderPanel1(d, chartW, p1H, axisW)
	panel2 := renderPanel2(d, chartW, p2H, axisW)
	panel3 := renderPanel3(d, chartW, p3H)

	// Header with live price.
	priceStr := ""
	if d.CurrentPrice > 0 {
		pCol := lipgloss.Color("#26A69A")
		if len(d.HACandles) > 0 {
			last := d.HACandles[len(d.HACandles)-1]
			if last.Close < last.Open {
				pCol = lipgloss.Color("#EF5350")
			}
		}
		priceStr = lipgloss.NewStyle().Foreground(pCol).Bold(true).
			Render(fmt.Sprintf("  %.2f", d.CurrentPrice))
	}

	header := headerStyle.Render(" ₿ BTCUSDT ") +
		intervalBadge.Render(d.Interval) +
		headerStyle.Render(" · Heikin Ashi") +
		priceStr +
		lipgloss.NewStyle().Foreground(textDim).Render(fmt.Sprintf("  ticks:%d", d.TickCount))
	if d.ErrMsg != "" {
		header += "  " + errStyle.Render("⚠ "+d.ErrMsg)
	}
	// Pad to fill width.
	header = lipgloss.NewStyle().Width(d.Width).Render(header)

	// Wrap panels.
	p1Styled := panelStyle.Width(d.Width - 2).Render(panel1)
	p2Styled := panelStyle.Width(d.Width - 2).Render(panel2)
	p3Styled := panelStyle.Width(d.Width - 2).Render(panel3)

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		p1Styled,
		p2Styled,
		p3Styled,
	)
}

// ──────────────────────────────────────────────
// Panel 1: Heikin Ashi + VWAP
// ──────────────────────────────────────────────

func renderPanel1(d LayoutData, chartW, chartH, axisW int) string {
	if len(d.HACandles) == 0 {
		return centerText("⏳ Waiting for data...", chartW+axisW, chartH)
	}

	canvas := chart.NewCanvas(chartW, chartH)
	visible := chart.VisibleCandles(d.HACandles, canvas.PixelWidth())
	yMin, yMax := chart.CandlesBounds(visible)

	// Expand Y for VWAP.
	visibleVWAP := tailSlice(d.VWAPValues, len(visible))
	expandBounds(&yMin, &yMax, visibleVWAP)

	// Draw candles first (background), then VWAP overlay.
	chart.RenderCandles(canvas, visible, yMin, yMax)
	chart.RenderSmoothLine(canvas, visibleVWAP, yMin, yMax, chart.ColVWAP, 1)

	// Legends.
	title := panelTitleStyle.Render("Price") + "  " + legendVWAP.Render("━ VWAP")

	// Current price label (raw exchange price, not Heikin Ashi).
	lastPrice := ""
	if d.CurrentPrice > 0 && len(visible) > 0 {
		lastHA := visible[len(visible)-1]
		priceColor := lipgloss.Color("#26A69A")
		// Color from HA direction, value from real exchange price.
		if lastHA.Close < lastHA.Open {
			priceColor = lipgloss.Color("#EF5350")
		}
		lastPrice = lipgloss.NewStyle().
			Foreground(priceColor).
			Bold(true).
			Render(fmt.Sprintf("  %.2f", d.CurrentPrice))
	}

	yAxis := renderYAxis(yMin, yMax, chartH, axisW)
	chartArea := canvas.Render()

	return lipgloss.JoinVertical(lipgloss.Left,
		title+lastPrice,
		lipgloss.JoinHorizontal(lipgloss.Top, yAxis, chartArea),
	)
}

// ──────────────────────────────────────────────
// Panel 2: EMA 9/21 + Pivots HL 10
// ──────────────────────────────────────────────

func renderPanel2(d LayoutData, chartW, chartH, axisW int) string {
	if len(d.HACandles) == 0 {
		return centerText("⏳ Waiting for data...", chartW+axisW, chartH)
	}

	canvas := chart.NewCanvas(chartW, chartH)
	nVisible := canvas.PixelWidth() / chart.CandleStride()
	nVisible = maxInt(nVisible, 1)

	visibleEMA9 := tailSlice(d.EMA9Values, nVisible)
	visibleEMA21 := tailSlice(d.EMA21Values, nVisible)
	visiblePivotH := tailSlice(d.PivotHighs, nVisible)
	visiblePivotL := tailSlice(d.PivotLows, nVisible)

	yMin, yMax := chart.ValueBounds(visibleEMA9, visibleEMA21)
	expandBounds(&yMin, &yMax, visiblePivotH)
	expandBounds(&yMin, &yMax, visiblePivotL)

	// Smooth EMA lines (thickness 2 for visibility).
	chart.RenderSmoothLine(canvas, visibleEMA9, yMin, yMax, chart.ColEMA9, 1)
	chart.RenderSmoothLine(canvas, visibleEMA21, yMin, yMax, chart.ColEMA21, 1)
	chart.RenderPivots(canvas, visiblePivotH, visiblePivotL, yMin, yMax)

	title := panelTitleStyle.Render("Indicators") + "  " +
		legendEMA9.Render("━ EMA9") + "  " +
		legendEMA21.Render("━ EMA21") + "  " +
		legendPivot.Render("◆ PivHL")

	yAxis := renderYAxis(yMin, yMax, chartH, axisW)
	chartArea := canvas.Render()

	return lipgloss.JoinVertical(lipgloss.Left,
		title,
		lipgloss.JoinHorizontal(lipgloss.Top, yAxis, chartArea),
	)
}

// ──────────────────────────────────────────────
// Panel 3: MACD (left) + RSI (right)
// ──────────────────────────────────────────────

func renderPanel3(d LayoutData, chartW, chartH int) string {
	if len(d.HACandles) == 0 {
		return centerText("⏳ Waiting for data...", chartW, chartH)
	}

	halfW := maxInt(chartW/2-1, 8)

	// === MACD ===
	macdCanvas := chart.NewCanvas(halfW, chartH)
	nVisible := macdCanvas.PixelWidth() / chart.CandleStride()
	nVisible = maxInt(nVisible, 1)

	visibleHist := tailSlice(d.MACDResult.Histogram, nVisible)
	visibleMACD := tailSlice(d.MACDResult.MACD, nVisible)
	visibleSignal := tailSlice(d.MACDResult.Signal, nVisible)

	macdYMin, macdYMax := chart.HistogramBounds(visibleHist)
	expandBounds(&macdYMin, &macdYMax, visibleMACD)
	expandBounds(&macdYMin, &macdYMax, visibleSignal)

	// Draw zero reference first.
	chart.DrawHLine(macdCanvas, 0, macdYMin, macdYMax, chart.ColHLine)
	// Histogram bars.
	chart.RenderHistogram(macdCanvas, visibleHist, macdYMin, macdYMax)
	// Smooth MACD and Signal lines on top.
	chart.RenderSmoothLine(macdCanvas, visibleMACD, macdYMin, macdYMax, chart.ColMACD, 1)
	chart.RenderSmoothLine(macdCanvas, visibleSignal, macdYMin, macdYMax, chart.ColSignal, 1)

	macdTitle := panelTitleStyle.Render("MACD ") +
		legendMACD.Render("━ MACD") + " " +
		legendSig.Render("━ Signal")

	macdPart := lipgloss.JoinVertical(lipgloss.Left, macdTitle, macdCanvas.Render())

	// === RSI ===
	rsiCanvas := chart.NewCanvas(halfW, chartH)
	visibleRSI := tailSlice(d.RSIValues, nVisible)
	rsiYMin := 0.0
	rsiYMax := 100.0

	// Draw shaded zones first (background layer).
	chart.DrawRSIZones(rsiCanvas, rsiYMin, rsiYMax, chart.Color256Bg(236))
	// Reference lines at 30 and 70.
	chart.DrawHLine(rsiCanvas, 30.0, rsiYMin, rsiYMax, chart.ColHLine)
	chart.DrawHLine(rsiCanvas, 70.0, rsiYMin, rsiYMax, chart.ColHLine)
	// Smooth RSI line on top.
	chart.RenderSmoothLine(rsiCanvas, visibleRSI, rsiYMin, rsiYMax, chart.ColRSI, 1)

	rsiTitle := panelTitleStyle.Render("RSI ") + legendRSI.Render("━ RSI(14)")

	// RSI current value badge.
	rsiVal := ""
	if len(visibleRSI) > 0 {
		v := visibleRSI[len(visibleRSI)-1]
		col := lipgloss.Color("#D1D4DC")
		if v >= 70 {
			col = lipgloss.Color("#EF5350")
		} else if v <= 30 {
			col = lipgloss.Color("#26A69A")
		}
		rsiVal = lipgloss.NewStyle().Foreground(col).Bold(true).
			Render(fmt.Sprintf(" %.1f", v))
	}

	rsiPart := lipgloss.JoinVertical(lipgloss.Left,
		rsiTitle+rsiVal,
		rsiCanvas.Render(),
	)

	separator := lipgloss.NewStyle().
		Foreground(borderDim).
		Render(strings.Repeat("│\n", chartH+1))

	return lipgloss.JoinHorizontal(lipgloss.Top, macdPart, " "+separator+" ", rsiPart)
}

// ──────────────────────────────────────────────
// Y-Axis
// ──────────────────────────────────────────────

func renderYAxis(yMin, yMax float64, height, width int) string {
	if height < 2 {
		return ""
	}
	lines := make([]string, height)
	for i := 0; i < height; i++ {
		ratio := float64(i) / float64(height-1)
		val := yMax - ratio*(yMax-yMin)
		label := fmt.Sprintf("%*.2f", width-1, val)
		lines[i] = axisLabelStyle.Render(label) + axisLabelStyle.Render("│")
	}
	return strings.Join(lines, "\n")
}

// ──────────────────────────────────────────────
// Loading & Modal
// ──────────────────────────────────────────────

// RenderLoading shows a centered loading screen.
func RenderLoading(width, height int, interval string) string {
	msg := fmt.Sprintf("⏳ Loading BTCUSDT %s ...", interval)
	return lipgloss.NewStyle().
		Width(width).
		Height(height).
		Align(lipgloss.Center).
		AlignVertical(lipgloss.Center).
		Foreground(accentGold).
		Render(msg)
}

// RenderModal renders a timeframe selection modal.
func RenderModal(base string, width, height int, items []string, selected int) string {
	modalBorder := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(accentGold).
		Padding(0, 1)

	var sb strings.Builder
	sb.WriteString(lipgloss.NewStyle().
		Foreground(textBright).Bold(true).
		Render("  Select Timeframe") + "\n")
	sb.WriteString(lipgloss.NewStyle().
		Foreground(borderDim).
		Render("  ──────────────────") + "\n")

	for i, item := range items {
		if i == selected {
			line := lipgloss.NewStyle().
				Foreground(accentGold).Bold(true).
				Render(fmt.Sprintf("  ▸ %s", item))
			sb.WriteString(line + "\n")
		} else {
			line := lipgloss.NewStyle().
				Foreground(textDim).
				Render(fmt.Sprintf("    %s", item))
			sb.WriteString(line + "\n")
		}
	}

	modal := modalBorder.Render(sb.String())

	return lipgloss.Place(width, height,
		lipgloss.Center, lipgloss.Center,
		modal,
		lipgloss.WithWhitespaceChars(" "),
	)
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func tailSlice(s []float64, n int) []float64 {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}

func expandBounds(yMin, yMax *float64, vals []float64) {
	for _, v := range vals {
		if v == 0 {
			continue
		}
		if v < *yMin {
			*yMin = v
		}
		if v > *yMax {
			*yMax = v
		}
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func centerText(msg string, width, height int) string {
	return lipgloss.NewStyle().
		Width(width).
		Height(height).
		Align(lipgloss.Center).
		AlignVertical(lipgloss.Center).
		Foreground(textDim).
		Render(msg)
}
