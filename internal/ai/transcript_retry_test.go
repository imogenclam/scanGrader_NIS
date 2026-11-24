package ai

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"scangrader/internal/grading"
	"scangrader/internal/pdf"
)

func TestMain(m *testing.M) {
	pdf.ServePDFHelper()
	os.Exit(m.Run())
}

func TestReviewReusesOnlyCompleteOCRForSameInputAndModel(t *testing.T) {
	renderer := false
	for _, name := range []string{"gs", "gswin64c", "gswin32c", "pdftoppm"} {
		if _, err := exec.LookPath(name); err == nil {
			renderer = true
			break
		}
	}
	if !renderer {
		t.Skip("нужен Ghostscript или Poppler")
	}
	body, err := os.ReadFile(filepath.Join("testdata", "addition.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "work.pdf")
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	ocrCalls, grades := 0, 0
	revision := "release-1"
	validOCR := true
	ocr := NewYandexOCR("test", "folder", "math-v1")
	ocr.HTTP = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		ocrCalls++
		if !validOCR {
			return localJSONResponse(`{"result":{"textAnnotation":{"fullText":""}}}`), nil
		}
		return localJSONResponse(`{"result":{"textAnnotation":{"fullText":"2+2=4"}}}`), nil
	})}
	chat := &ChatClient{APIKey: "test", BaseURL: "https://grading.invalid/v1", Model: "grade-v1"}
	chat.HTTP = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		grades++
		if grades == 1 {
			return localJSONResponse(`{"choices":[]}`), nil
		}
		return localJSONResponse(`{"choices":[{"message":{"content":"{\"grades\":[{\"number\":1,\"score\":1,\"comment\":\"Верно\"}]}"}}]}`), nil
	})}
	check := func(wantError bool, wantOCR, wantGrades int) {
		t.Helper()
		// Новый объект Pipeline имитирует повтор после перезапуска процесса.
		p := &Pipeline{OCR: ocr, Chat: chat, OCRRevision: revision}
		_, err := p.Review(context.Background(), path, "Арифметика", "2+2", "4", []grading.Task{{Number: 1, Max: 1}})
		if (err != nil) != wantError || ocrCalls != wantOCR || grades != wantGrades {
			t.Fatalf("ошибка %v, вызовы OCR/оценки %d/%d, ожидались %d/%d", err, ocrCalls, grades, wantOCR, wantGrades)
		}
	}
	check(true, 1, 1)
	chat.Model = "grade-v2"
	check(false, 1, 2)
	ocr.Model = "math-v2"
	check(false, 2, 3)
	if err := os.WriteFile(path, append(body, []byte("\n% changed PDF\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	validOCR = false
	check(true, 3, 3)
	validOCR = true
	check(false, 4, 4)
	check(false, 4, 5)
	revision = "release-2"
	check(false, 5, 6)
	if err := os.WriteFile(path+".ocr.json", []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	check(false, 6, 7)
	// Другая сдача с теми же байтами имеет собственный закрытый файл OCR.
	previous, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	path = filepath.Join(filepath.Dir(path), "other-work.pdf")
	if err := os.WriteFile(path, previous, 0600); err != nil {
		t.Fatal(err)
	}
	check(false, 7, 8)
}
