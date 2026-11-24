package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"scangrader/src/grading"
	"scangrader/src/storage"
)

func New(store *storage.Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Ping(r.Context()); err != nil {
			writeError(w, 503, "база данных недоступна")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	review := func(w http.ResponseWriter, r *http.Request) {
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
			handleError(w, grading.ErrUnauthorized)
			return
		}
		actor, err := store.Authenticate(r.Context(), token)
		if err != nil {
			handleError(w, err)
			return
		}
		if r.Method == http.MethodPost && actor.Role != grading.Teacher {
			handleError(w, grading.ErrForbidden)
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			handleError(w, grading.ErrNotFound)
			return
		}
		var result grading.Submission
		if r.Method == http.MethodPost {
			grades, ok := readGrades(w, r)
			if !ok {
				return
			}
			result, err = store.Approve(r.Context(), id, actor, grades)
		} else {
			result, err = store.Submission(r.Context(), id, actor)
		}
		if err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, 200, result)
	}
	mux.HandleFunc("GET /api/submissions/{id}", review)
	mux.HandleFunc("POST /api/submissions/{id}/approve", review)
	return mux
}

func readGrades(w http.ResponseWriter, r *http.Request) ([]grading.Grade, bool) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		writeError(w, 415, "требуется Content-Type application/json")
		return nil, false
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			writeError(w, 413, "размер запроса превышает 1 МиБ")
		} else {
			writeError(w, 400, "не удалось прочитать запрос")
		}
		return nil, false
	}
	var payload struct {
		Grades []grading.Grade `json:"grades"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || decoder.Decode(new(any)) != io.EOF {
		writeError(w, 400, "ожидается один JSON-объект с массивом grades")
		return nil, false
	}
	return payload.Grades, true
}

func handleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, grading.ErrUnauthorized):
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeError(w, 401, err.Error())
	case errors.Is(err, grading.ErrForbidden):
		writeError(w, 403, err.Error())
	case errors.Is(err, grading.ErrNotFound):
		writeError(w, 404, err.Error())
	case errors.Is(err, grading.ErrInvalid):
		writeError(w, 400, err.Error())
	case errors.Is(err, grading.ErrApproved):
		writeError(w, 409, err.Error())
	default:
		slog.Error("ошибка при работе со сдачей", "err", err)
		writeError(w, 500, "внутренняя ошибка сервера")
	}
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}
