package model

import (
	"github.com/YoungGoofy/btc_term/internal/binance"
)

// HistoryMsg is sent when historical klines are loaded from REST API.
type HistoryMsg struct {
	Candles []binance.Candle
}

// ErrorMsg is sent when any async operation fails.
type ErrorMsg struct {
	Err error
}
