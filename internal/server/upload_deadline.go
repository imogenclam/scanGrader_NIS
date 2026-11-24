package server

import (
	"errors"
	"net/http"
	"time"

	"scangrader/internal/pdf"
)

func setUploadDeadlines(w http.ResponseWriter, contentLength int64) error {
	// Для chunked-запроса размер узнаем только после чтения.
	if contentLength < 0 || contentLength > pdf.MaxBytes {
		contentLength = pdf.MaxBytes
	}
	// Как и клиент в web/src/lib/api.ts, даём минуту на начало передачи и считаем по 25 КБ/с.
	transfer := time.Duration(contentLength) * time.Second / 25_000
	readBy := time.Now().Add(time.Minute + transfer)
	controller := http.NewResponseController(w)
	if err := controller.SetReadDeadline(readBy); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	// После загрузки проверка PDF может ждать слот 30 с и выполняться ещё 60 с.
	err := controller.SetWriteDeadline(readBy.Add(2 * time.Minute))
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}
