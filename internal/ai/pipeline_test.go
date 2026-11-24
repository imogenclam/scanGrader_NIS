package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"scangrader/internal/grading"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOCRAndReviewContracts(t *testing.T) {
	page := filepath.Join(t.TempDir(), "page.jpg")
	if err := os.WriteFile(page, []byte("synthetic image"), 0600); err != nil {
		t.Fatal(err)
	}
	ocr := NewYandexOCR("test-key", "test-folder", "math-markdown")
	ocr.HTTP = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		var v struct{ Content, Model string }
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			t.Error(err)
		}
		if v.Content != base64.StdEncoding.EncodeToString([]byte("synthetic image")) || v.Model != "math-markdown" || r.Header.Get("x-folder-id") != "test-folder" {
			t.Error("не переданы страница и параметры OCR")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"result":{"textAnnotation":{"fullText":"Решение $x=2$"}}}`)), Header: make(http.Header)}, nil
	})}
	transcript, err := ocr.TranscribeSubmission(context.Background(), []string{page})
	if err != nil || !strings.Contains(transcript, "$x=2$") {
		t.Fatal(transcript, err)
	}
	response := `{"grades":[{"number":1,"score":0.7,"comment":"Ошибка в вычислении."}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Model    string
			Messages []map[string]string
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1/chat/completions" || req.Model != "test-model" || len(req.Messages) != 2 || !strings.Contains(req.Messages[0]["content"], "Закрытое решение") || !strings.Contains(req.Messages[1]["content"], "$x=2$") {
			t.Error("не совпадает контракт сверки с эталоном")
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": response}}}})
	}))
	defer srv.Close()
	c := &ChatClient{"test-key", srv.URL + "/v1", "test-model", srv.Client()}
	tasks := []grading.Task{{Number: 1, Max: 1}}
	grades, err := c.grade(context.Background(), transcript, "Предел", "Условие", "Закрытое решение", tasks)
	if err != nil || len(grades) != 1 || *grades[0].Score != 0.7 {
		t.Fatal(grades, err)
	}
	response = `{"grades":[{"number":1,"score":1.2,"comment":"Ошибка."}]}`
	if _, err = c.grade(context.Background(), transcript, "Предел", "Условие", "Закрытое решение", tasks); err == nil {
		t.Fatal("принят балл сверх максимума")
	}
}
