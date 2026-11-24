package ai

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"time"
)

// retry — сколько раз повторять запрос к внешнему сервису и когда.
type retry struct {
	attempts int
	// перед попыткой n+1 ждём n*pause
	pause    time.Duration
	onErr    func(error) bool
	onStatus func(int) bool
}

// чужие сервисы ИИ и OCR: любой сбой сети, 429 и 5xx
var retryAnyFailure = retry{
	attempts: 3,
	pause:    2 * time.Second,
	onErr:    func(error) bool { return true },
	onStatus: func(code int) bool { return code == http.StatusTooManyRequests || code >= 500 },
}

// do повторяет send, пока тот не вернёт 200 или не кончатся попытки; отдаёт последний ответ.
func (p retry) do(ctx context.Context, send func(context.Context) (int, []byte, error)) (int, []byte, error) {
	for attempt := 1; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return 0, nil, err
		}
		status, body, err := send(ctx)
		last := attempt >= p.attempts
		if err != nil {
			if last || !p.onErr(err) {
				return 0, nil, err
			}
		} else if status == http.StatusOK || last || !p.onStatus(status) {
			return status, body, nil
		}
		select {
		case <-ctx.Done():
			return 0, nil, ctx.Err()
		case <-time.After(time.Duration(attempt) * p.pause):
		}
	}
}

// postJSON — один POST с JSON-телом; status 0 — запрос не дошёл.
func postJSON(ctx context.Context, hc *http.Client, url string, body []byte, header map[string]string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, data, err
}
