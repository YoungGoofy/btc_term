package binance

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

const baseURL = "https://fapi.binance.com"

// FetchKlines retrieves historical klines from Binance USDS-M Futures REST API.
func FetchKlines(symbol, interval string, limit int) ([]Candle, error) {
	url := fmt.Sprintf("%s/fapi/v1/klines?symbol=%s&interval=%s&limit=%d",
		baseURL, symbol, interval, limit)

	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetch klines: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("binance API error %d: %s", resp.StatusCode, string(body))
	}

	var raw [][]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode klines: %w", err)
	}

	candles := make([]Candle, 0, len(raw))
	for _, row := range raw {
		if len(row) < 6 {
			continue
		}
		c, err := parseKlineRow(row)
		if err != nil {
			continue
		}
		candles = append(candles, c)
	}
	return candles, nil
}

func parseKlineRow(row []json.RawMessage) (Candle, error) {
	var openTime int64
	if err := json.Unmarshal(row[0], &openTime); err != nil {
		return Candle{}, err
	}

	parseFloat := func(raw json.RawMessage) (float64, error) {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return 0, err
		}
		return strconv.ParseFloat(s, 64)
	}

	open, err := parseFloat(row[1])
	if err != nil {
		return Candle{}, err
	}
	high, err := parseFloat(row[2])
	if err != nil {
		return Candle{}, err
	}
	low, err := parseFloat(row[3])
	if err != nil {
		return Candle{}, err
	}
	close_, err := parseFloat(row[4])
	if err != nil {
		return Candle{}, err
	}
	volume, err := parseFloat(row[5])
	if err != nil {
		return Candle{}, err
	}

	return Candle{
		OpenTime: openTime,
		Open:     open,
		High:     high,
		Low:      low,
		Close:    close_,
		Volume:   volume,
	}, nil
}
