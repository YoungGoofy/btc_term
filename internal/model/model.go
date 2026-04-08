package model

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/YoungGoofy/btc_term/internal/binance"
	"github.com/YoungGoofy/btc_term/internal/indicator"
	"github.com/YoungGoofy/btc_term/internal/ui"
)

// wsReconnectMsg triggers a WebSocket reconnection attempt.
type wsReconnectMsg struct {
	symbol   string
	interval string
}

const (
	symbol     = "BTCUSDT"
	maxCandles = 500
)

// Available timeframes.
var timeframes = []string{"1m", "5m", "15m", "4h"}

// Model is the main Bubble Tea model.
type Model struct {
	// Terminal dimensions.
	width  int
	height int

	// Data.
	rawCandles []binance.Candle
	haCandles  []binance.Candle
	interval   string

	// Indicators.
	vwap   *indicator.VWAP
	ema9   *indicator.EMA
	ema21  *indicator.EMA
	macd   *indicator.MACDCalc
	rsi    *indicator.RSICalc
	pivots *indicator.PivotsHL

	// Indicator values (for rendering).
	vwapValues  []float64
	ema9Values  []float64
	ema21Values []float64
	macdResult  indicator.MACDResult
	rsiValues   []float64

	// WebSocket.
	ws     *binance.WSClient
	tickCh chan binance.TickMsg // PERSISTENT channel — lives for the entire model lifetime

	// UI state.
	loading   bool
	showModal bool
	modalIdx  int
	errMsg    string
	tickCount int // debug: number of ticks received
}

// New creates a new Model with default state.
func New() Model {
	return Model{
		interval: "1m",
		loading:  true,
		tickCh:   make(chan binance.TickMsg, 128), // shared persistent channel
		vwap:     indicator.NewVWAP(),
		ema9:     indicator.NewEMA(9),
		ema21:    indicator.NewEMA(21),
		macd:     indicator.NewMACD(),
		rsi:      indicator.NewRSI(14),
		pivots:   indicator.NewPivotsHL(10),
	}
}

// Init returns the initial command to fetch historical data.
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		fetchHistory(symbol, m.interval),
		waitForTick(m.tickCh), // start listening on the persistent channel immediately
	)
}

// waitForTick is a standalone function that reads one tick from the channel
// and returns it as a tea.Msg. The channel is persistent — it's never closed
// during normal operation, only when the program exits.
func waitForTick(ch chan binance.TickMsg) tea.Cmd {
	return func() tea.Msg {
		tick, ok := <-ch
		if !ok {
			return binance.WSErrorMsg{Err: fmt.Errorf("tick channel closed")}
		}
		return tick
	}
}

// Update handles incoming messages.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case HistoryMsg:
		m.rawCandles = msg.Candles
		m.recalcAll()
		m.loading = false
		m.errMsg = ""

		// Close previous WS if any (its readLoop will exit).
		if m.ws != nil {
			m.ws.Close()
			m.ws = nil
		}

		// Open new WS — it writes to the SAME persistent m.tickCh.
		ws, err := binance.NewWSClient(symbol, m.interval, m.tickCh)
		if err != nil {
			m.errMsg = fmt.Sprintf("WS error: %v", err)
			return m, nil
		}
		m.ws = ws
		// Note: we do NOT return waitForTick here — it was already started
		// in Init() and re-issued after each tick. The listen loop is
		// always running.
		return m, nil

	case binance.TickMsg:
		m.tickCount++
		m.handleTick(msg)
		// Continue listening for the next tick from the persistent channel.
		return m, waitForTick(m.tickCh)

	case binance.WSErrorMsg:
		m.errMsg = fmt.Sprintf("WS: %v (reconnecting…)", msg.Err)
		if m.ws != nil {
			m.ws.Close()
			m.ws = nil
		}
		// Reconnect after a short delay. waitForTick is still running via
		// the persistent channel, so when the new WSClient starts writing,
		// ticks will flow again.
		return m, reconnectAfter(symbol, m.interval, 2*time.Second)

	case wsReconnectMsg:
		ws, err := binance.NewWSClient(msg.symbol, msg.interval, m.tickCh)
		if err != nil {
			m.errMsg = fmt.Sprintf("WS reconnect failed: %v", err)
			return m, reconnectAfter(msg.symbol, msg.interval, 5*time.Second)
		}
		m.ws = ws
		m.errMsg = ""
		// waitForTick is already running, ticks will flow through tickCh.
		return m, nil

	case ErrorMsg:
		m.errMsg = msg.Err.Error()
		m.loading = false
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	return m, nil
}

// View renders the full UI.
func (m Model) View() string {
	if m.loading {
		return ui.RenderLoading(m.width, m.height, m.interval)
	}

	if m.showModal {
		base := m.renderCharts()
		return ui.RenderModal(base, m.width, m.height, timeframes, m.modalIdx)
	}

	return m.renderCharts()
}

func (m Model) renderCharts() string {
	return ui.RenderLayout(ui.LayoutData{
		Width:       m.width,
		Height:      m.height,
		HACandles:   m.haCandles,
		VWAPValues:  m.vwapValues,
		EMA9Values:  m.ema9Values,
		EMA21Values: m.ema21Values,
		MACDResult:  m.macdResult,
		RSIValues:   m.rsiValues,
		PivotHighs:  m.pivots.Highs,
		PivotLows:   m.pivots.Lows,
		Interval:    m.interval,
		ErrMsg:      m.errMsg,
		TickCount:   m.tickCount,
	})
}

func (m *Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		if m.ws != nil {
			m.ws.Close()
		}
		return m, tea.Quit

	case "tab":
		m.showModal = !m.showModal
		m.modalIdx = 0
		return m, nil

	case "up", "k":
		if m.showModal && m.modalIdx > 0 {
			m.modalIdx--
		}
		return m, nil

	case "down", "j":
		if m.showModal && m.modalIdx < len(timeframes)-1 {
			m.modalIdx++
		}
		return m, nil

	case "enter":
		if m.showModal {
			newInterval := timeframes[m.modalIdx]
			m.showModal = false
			if newInterval != m.interval {
				m.interval = newInterval
				m.loading = true
				if m.ws != nil {
					m.ws.Close()
					m.ws = nil
				}
				return m, fetchHistory(symbol, m.interval)
			}
		}
		return m, nil
	}

	return m, nil
}

func (m *Model) handleTick(tick binance.TickMsg) {
	if len(m.rawCandles) == 0 {
		return
	}

	last := m.rawCandles[len(m.rawCandles)-1]

	if tick.Candle.OpenTime == last.OpenTime {
		// Update existing candle.
		prevRaw := m.rawCandles[len(m.rawCandles)-1]
		m.rawCandles[len(m.rawCandles)-1] = tick.Candle

		// Update HA.
		if len(m.haCandles) >= 2 {
			m.haCandles[len(m.haCandles)-1] = indicator.UpdateLastHA(
				m.haCandles[len(m.haCandles)-2], tick.Candle)
		}

		// Update indicators incrementally.
		m.vwap.Update(prevRaw, tick.Candle)
		m.ema9.Update(tick.Candle.Close)
		m.ema21.Update(tick.Candle.Close)
		m.macd.Update(tick.Candle.Close)

		if len(m.rawCandles) >= 2 {
			m.rsi.Update(m.rawCandles[len(m.rawCandles)-2].Close, tick.Candle.Close)
		}

		// Sync indicator slices.
		m.syncIndicatorValues()

	} else if tick.Candle.OpenTime > last.OpenTime {
		// New candle.
		m.rawCandles = append(m.rawCandles, tick.Candle)
		if len(m.rawCandles) > maxCandles {
			m.rawCandles = m.rawCandles[1:]
		}

		if len(m.haCandles) > 0 {
			newHA := indicator.UpdateLastHA(m.haCandles[len(m.haCandles)-1], tick.Candle)
			m.haCandles = append(m.haCandles, newHA)
			if len(m.haCandles) > maxCandles {
				m.haCandles = m.haCandles[1:]
			}
		}

		m.vwap.AddNew(tick.Candle)
		m.ema9.AddNew(tick.Candle.Close)
		m.ema21.AddNew(tick.Candle.Close)
		m.macd.AddNew(tick.Candle.Close)
		m.rsi.AddNew(tick.Candle.Close)
		m.pivots.Recalculate(m.haCandles)

		m.trimIndicators()
	}
}

func (m *Model) recalcAll() {
	m.haCandles = indicator.ConvertToHA(m.rawCandles)

	closes := make([]float64, len(m.rawCandles))
	for i, c := range m.rawCandles {
		closes[i] = c.Close
	}

	m.vwapValues = m.vwap.Calculate(m.rawCandles)
	m.ema9Values = m.ema9.Calculate(closes)
	m.ema21Values = m.ema21.Calculate(closes)
	m.macdResult = m.macd.Calculate(closes)
	m.rsiValues = m.rsi.Calculate(closes)
	m.pivots.Calculate(m.haCandles)
}

func (m *Model) syncIndicatorValues() {
	m.vwapValues = m.vwap.Values
	m.ema9Values = m.ema9.Values
	m.ema21Values = m.ema21.Values
	m.macdResult = m.macd.Result
	m.rsiValues = m.rsi.Values
}

func (m *Model) trimIndicators() {
	n := len(m.haCandles)
	m.vwapValues = trimSlice(m.vwap.Values, n)
	m.ema9Values = trimSlice(m.ema9.Values, n)
	m.ema21Values = trimSlice(m.ema21.Values, n)
	m.macdResult.MACD = trimSlice(m.macdResult.MACD, n)
	m.macdResult.Signal = trimSlice(m.macdResult.Signal, n)
	m.macdResult.Histogram = trimSlice(m.macdResult.Histogram, n)
	m.rsiValues = trimSlice(m.rsi.Values, n)
}

func trimSlice(s []float64, maxLen int) []float64 {
	if len(s) > maxLen {
		return s[len(s)-maxLen:]
	}
	return s
}

func fetchHistory(sym, interval string) tea.Cmd {
	return func() tea.Msg {
		candles, err := binance.FetchKlines(sym, interval, maxCandles)
		if err != nil {
			return ErrorMsg{Err: err}
		}
		return HistoryMsg{Candles: candles}
	}
}

func reconnectAfter(sym, interval string, delay time.Duration) tea.Cmd {
	return tea.Tick(delay, func(t time.Time) tea.Msg {
		return wsReconnectMsg{symbol: sym, interval: interval}
	})
}
