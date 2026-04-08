package chart

import (
	"fmt"
	"strings"
)

// Braille dot positions within a cell (2 columns × 4 rows):
//
//	Col 0    Col 1
//	(0,0)    (1,0)   — dot1 / dot4
//	(0,1)    (1,1)   — dot2 / dot5
//	(0,2)    (1,2)   — dot3 / dot6
//	(0,3)    (1,3)   — dot7 / dot8
//
// Braille base: U+2800
// Bit mapping:
//
//	dot1=0x01, dot2=0x02, dot3=0x04, dot4=0x08
//	dot5=0x10, dot6=0x20, dot7=0x40, dot8=0x80
var brailleBits = [2][4]rune{
	{0x01, 0x02, 0x04, 0x40}, // column 0
	{0x08, 0x10, 0x20, 0x80}, // column 1
}

const brailleBase = 0x2800

// ──────────────────────────────────────────────
// TradingView-inspired color palette (256-color)
// ──────────────────────────────────────────────

// Candle colors – emerald green / ruby red.
var (
	ColCandleUp   = color256(72)  // #26A69A-ish emerald
	ColCandleDown = color256(167) // #EF5350-ish ruby

	ColWickUp   = color256(72)
	ColWickDown = color256(167)

	// Indicator line colors.
	ColVWAP    = color256(208) // warm orange
	ColEMA9    = color256(39)  // bright blue
	ColEMA21   = color256(135) // purple
	ColMACD    = color256(39)  // blue
	ColSignal  = color256(208) // orange
	ColRSI     = color256(183) // light magenta
	ColPivotHi = color256(213) // pink
	ColPivotLo = color256(75)  // light blue

	// UI chrome.
	ColAxis     = color256(240) // dim gray
	ColAxisText = color256(246) // lighter gray
	ColGrid     = color256(236) // very dark gray
	ColZone     = color256(236) // RSI overbought/oversold zone fill
	ColHLine    = color256(239) // horizontal reference lines (30/70)
)

func color256(n int) string {
	return fmt.Sprintf("\033[38;5;%dm", n)
}

// Color256Bg returns an ANSI 256-color background escape.
func Color256Bg(n int) string {
	return fmt.Sprintf("\033[48;5;%dm", n)
}

const resetColor = "\033[0m"

// ──────────────────────────────────────────────
// Layer – each cell can carry multiple colored layers;
// the last-drawn foreground wins, but any layer sets dots.
// ──────────────────────────────────────────────

// Canvas is a high-resolution Braille drawing surface.
// Each terminal cell = 2×4 dot grid (sub-pixel).
type Canvas struct {
	Width  int // terminal columns
	Height int // terminal rows
	dots   [][]rune   // braille dot bits per cell
	fg     [][]string // foreground ANSI color per cell
	bg     [][]string // background ANSI per cell (optional)
}

// NewCanvas creates a blank canvas with the given terminal dimensions.
func NewCanvas(width, height int) *Canvas {
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}

	dots := make([][]rune, height)
	fg := make([][]string, height)
	bg := make([][]string, height)
	for y := 0; y < height; y++ {
		dots[y] = make([]rune, width)
		fg[y] = make([]string, width)
		bg[y] = make([]string, width)
	}

	return &Canvas{
		Width:  width,
		Height: height,
		dots:   dots,
		fg:     fg,
		bg:     bg,
	}
}

// Clear resets every cell.
func (c *Canvas) Clear() {
	for y := 0; y < c.Height; y++ {
		for x := 0; x < c.Width; x++ {
			c.dots[y][x] = 0
			c.fg[y][x] = ""
			c.bg[y][x] = ""
		}
	}
}

// PixelWidth returns the sub-pixel horizontal resolution.
func (c *Canvas) PixelWidth() int { return c.Width * 2 }

// PixelHeight returns the sub-pixel vertical resolution.
func (c *Canvas) PixelHeight() int { return c.Height * 4 }

// ──────────────────────────────────────────────
// Dot-level primitives
// ──────────────────────────────────────────────

// Set sets a single Braille dot (no color).
func (c *Canvas) Set(px, py int) {
	if px < 0 || py < 0 {
		return
	}
	cx, cy := px/2, py/4
	if cx >= c.Width || cy >= c.Height {
		return
	}
	c.dots[cy][cx] |= brailleBits[px%2][py%4]
}

// SetColor sets a dot and assigns a foreground color to that cell.
func (c *Canvas) SetColor(px, py int, color string) {
	if px < 0 || py < 0 {
		return
	}
	cx, cy := px/2, py/4
	if cx >= c.Width || cy >= c.Height {
		return
	}
	c.dots[cy][cx] |= brailleBits[px%2][py%4]
	if color != "" {
		c.fg[cy][cx] = color
	}
}

// SetBg sets the background color of a terminal cell (without adding dots).
func (c *Canvas) SetBg(cellX, cellY int, bgColor string) {
	if cellX < 0 || cellY < 0 || cellX >= c.Width || cellY >= c.Height {
		return
	}
	c.bg[cellY][cellX] = bgColor
}

// ──────────────────────────────────────────────
// Shape primitives
// ──────────────────────────────────────────────

// FillRect fills a rectangle of Braille dots (solid block).
// Coordinates are in sub-pixel space.
func (c *Canvas) FillRect(x0, y0, x1, y1 int, color string) {
	if x0 > x1 {
		x0, x1 = x1, x0
	}
	if y0 > y1 {
		y0, y1 = y1, y0
	}
	for py := y0; py <= y1; py++ {
		for px := x0; px <= x1; px++ {
			c.SetColor(px, py, color)
		}
	}
}

// VLine draws a vertical line from py0 to py1 at pixel column px.
func (c *Canvas) VLine(px, py0, py1 int, color string) {
	if py0 > py1 {
		py0, py1 = py1, py0
	}
	for py := py0; py <= py1; py++ {
		c.SetColor(px, py, color)
	}
}

// DrawThickLine draws a smooth thick line between two points using
// Bresenham with vertical spread for anti-aliased appearance.
func (c *Canvas) DrawThickLine(x0, y0, x1, y1 int, thickness int, color string) {
	half := thickness / 2

	dx := iabs(x1 - x0)
	dy := -iabs(y1 - y0)
	sx := 1
	if x0 > x1 {
		sx = -1
	}
	sy := 1
	if y0 > y1 {
		sy = -1
	}
	err := dx + dy

	for {
		// Draw a vertical spread at each point for thickness.
		for d := -half; d <= half; d++ {
			c.SetColor(x0, y0+d, color)
		}
		if x0 == x1 && y0 == y1 {
			break
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

// FillZone fills background color for a horizontal band of terminal cells.
func (c *Canvas) FillZone(cellY0, cellY1 int, bgColor string) {
	if cellY0 > cellY1 {
		cellY0, cellY1 = cellY1, cellY0
	}
	for cy := cellY0; cy <= cellY1; cy++ {
		if cy < 0 || cy >= c.Height {
			continue
		}
		for cx := 0; cx < c.Width; cx++ {
			c.bg[cy][cx] = bgColor
		}
	}
}

// ──────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────

// Render outputs the canvas as a string of Braille characters with ANSI colors.
func (c *Canvas) Render() string {
	var sb strings.Builder
	sb.Grow(c.Width * c.Height * 8)

	for y := 0; y < c.Height; y++ {
		for x := 0; x < c.Width; x++ {
			ch := brailleBase + c.dots[y][x]
			fgCol := c.fg[y][x]
			bgCol := c.bg[y][x]

			hasStyle := fgCol != "" || bgCol != ""
			if hasStyle {
				if bgCol != "" {
					sb.WriteString(bgCol)
				}
				if fgCol != "" {
					sb.WriteString(fgCol)
				}
				sb.WriteRune(ch)
				sb.WriteString(resetColor)
			} else {
				sb.WriteRune(ch)
			}
		}
		if y < c.Height-1 {
			sb.WriteByte('\n')
		}
	}
	return sb.String()
}

func iabs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
