package binance

// Candle represents a single OHLCV candlestick.
type Candle struct {
	OpenTime int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
}

// BinanceWSMessage is the top-level WebSocket kline message.
type BinanceWSMessage struct {
	Event string         `json:"e"`
	Time  int64          `json:"E"`
	Kline BinanceWSKline `json:"k"`
}

// BinanceWSKline is the nested kline object within a WebSocket message.
type BinanceWSKline struct {
	StartTime int64  `json:"t"`
	EndTime   int64  `json:"T"`
	Open      string `json:"o"`
	High      string `json:"h"`
	Low       string `json:"l"`
	Close     string `json:"c"`
	Volume    string `json:"v"`
	IsClosed  bool   `json:"x"`
}
