package binance

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gorilla/websocket"
)

const wsBaseURL = "wss://fstream.binance.com/ws"

// TickMsg is sent to the Bubble Tea runtime for every kline WebSocket update.
type TickMsg struct {
	Candle   Candle
	IsClosed bool
}

// WSErrorMsg is sent when the WebSocket encounters an error.
type WSErrorMsg struct {
	Err error
}

// WSClient manages a single Binance WebSocket connection.
// It writes parsed ticks to an EXTERNAL channel provided by the caller.
type WSClient struct {
	conn      *websocket.Conn
	done      chan struct{}
	closeOnce sync.Once
}

// NewWSClient connects to the Binance kline stream and starts a reader
// goroutine that writes TickMsg values to the provided outCh.
// The caller owns the channel — multiple WSClients can write to it sequentially.
func NewWSClient(symbol, interval string, outCh chan<- tea.Msg) (*WSClient, error) {
	stream := fmt.Sprintf("%s/%s@kline_%s",
		wsBaseURL, strings.ToLower(symbol), interval)

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(stream, nil)
	if err != nil {
		return nil, fmt.Errorf("ws dial: %w", err)
	}

	// Handle server pings (keep-alive).
	conn.SetPingHandler(func(appData string) error {
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return conn.WriteControl(
			websocket.PongMessage, []byte(appData),
			time.Now().Add(5*time.Second),
		)
	})

	ws := &WSClient{
		conn: conn,
		done: make(chan struct{}),
	}

	go ws.readLoop(outCh)

	return ws, nil
}

// readLoop continuously reads from the WebSocket and pushes parsed ticks
// to the external output channel. Exits when the connection closes or
// when Close() is called.
func (ws *WSClient) readLoop(outCh chan<- tea.Msg) {
	for {
		_ = ws.conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		_, message, err := ws.conn.ReadMessage()
		if err != nil {
			select {
			case <-ws.done:
				// Intentional shutdown — exit silently.
			default:
				// Connection error — notify UI for reconnect.
				outCh <- WSErrorMsg{Err: err}
			}
			return
		}

		var wsMsg BinanceWSMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			continue
		}

		candle, err := wsKlineToCandle(wsMsg.Kline)
		if err != nil {
			continue
		}

		tick := TickMsg{
			Candle:   candle,
			IsClosed: wsMsg.Kline.IsClosed,
		}

		select {
		case outCh <- tick:
		case <-ws.done:
			return
		}
	}
}

// Close shuts down the connection and reader goroutine. Safe to call multiple times.
func (ws *WSClient) Close() {
	ws.closeOnce.Do(func() {
		close(ws.done)
		if ws.conn != nil {
			ws.conn.Close()
		}
	})
}

func wsKlineToCandle(k BinanceWSKline) (Candle, error) {
	open, err := strconv.ParseFloat(k.Open, 64)
	if err != nil {
		return Candle{}, err
	}
	high, err := strconv.ParseFloat(k.High, 64)
	if err != nil {
		return Candle{}, err
	}
	low, err := strconv.ParseFloat(k.Low, 64)
	if err != nil {
		return Candle{}, err
	}
	close_, err := strconv.ParseFloat(k.Close, 64)
	if err != nil {
		return Candle{}, err
	}
	volume, err := strconv.ParseFloat(k.Volume, 64)
	if err != nil {
		return Candle{}, err
	}

	return Candle{
		OpenTime: k.StartTime,
		Open:     open,
		High:     high,
		Low:      low,
		Close:    close_,
		Volume:   volume,
	}, nil
}
