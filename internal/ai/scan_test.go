package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"scangrader/internal/grading"
)

// Используем тот же PDF, что и в сквозном HTTP-примере. Ответы внешних сервисов фиксированы.
func TestRenderedScanToDraft(t *testing.T) {
	hasRenderer := false
	for _, cmd := range []string{"gs", "gswin64c", "gswin32c", "pdftoppm"} {
		if _, err := exec.LookPath(cmd); err == nil {
			hasRenderer = true
			break
		}
	}
	if !hasRenderer {
		t.Skip("Для проверки рендеринга установите Ghostscript или Poppler")
	}
	path := filepath.Join(t.TempDir(), "scan.pdf")
	doc, err := os.ReadFile(filepath.Join("testdata", "addition.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, doc, 0600); err != nil {
		t.Fatal(err)
	}
	ocrCalls, chatCalls := 0, 0
	ocr := NewYandexOCR("test-only", "local", "math-markdown")
	ocr.HTTP = &http.Client{Transport: roundTrip(func(req *http.Request) (*http.Response, error) {
		var body struct{ Content, MimeType string }
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			return nil, err
		}
		raw, err := base64.StdEncoding.DecodeString(body.Content)
		if err != nil {
			return nil, err
		}
		image, err := jpeg.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		if body.MimeType != "image/jpeg" || image.Bounds().Dx() < 200 || image.Bounds().Dy() < 160 {
			t.Errorf("недопустимая страница: %s, %v", body.MimeType, image.Bounds())
		}
		var dark bool
		for y := image.Bounds().Min.Y; y < image.Bounds().Max.Y && !dark; y++ {
			for x := image.Bounds().Min.X; x < image.Bounds().Max.X; x++ {
				r, _, _, _ := image.At(x, y).RGBA()
				if r < 0x6000 {
					dark = true
					break
				}
			}
		}
		if !dark {
			t.Error("на странице не видно решения")
		}
		ocrCalls++
		return localJSONResponse("{\"result\":{\"textAnnotation\":{\"fullText\":\"2 + 2 = 4\"}}}"), nil
	})}
	chat := &ChatClient{APIKey: "test-only", BaseURL: "https://adapter.invalid/v1", Model: "local"}
	chat.HTTP = &http.Client{Transport: roundTrip(func(req *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		if !strings.Contains(string(body), "2 + 2 = 4") || !strings.Contains(string(body), "reference-four") {
			return nil, errors.New("в сравнении нет результата OCR или эталона")
		}
		chatCalls++
		return localJSONResponse("{\"choices\":[{\"message\":{\"content\":\"{\\\"grades\\\":[{\\\"number\\\":1,\\\"score\\\":1,\\\"comment\\\":\\\"Верно\\\"}]}\"}}]}"), nil
	})}
	result, err := (&Pipeline{OCR: ocr, Chat: chat}).Review(context.Background(), path, "Арифметика", "2 + 2", "reference-four", []grading.Task{{Number: 1, Max: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if ocrCalls != 1 || chatCalls != 1 || len(result) != 1 || result[0].Score == nil || *result[0].Score != 1 {
		t.Fatalf("вызовы %d/%d, оценки %v", ocrCalls, chatCalls, result)
	}
}

func localJSONResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
