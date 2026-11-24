package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const yandexOCRRecognizeURL = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText"

// на страницу работы пять попыток, у ИИ три
const yandexOCRAttempts = 5

type YandexOCRClient struct {
	APIKey   string
	FolderID string
	Model    string
	HTTP     *http.Client
}

// NewYandexOCR возвращает nil без ключа или каталога.
func NewYandexOCR(key, folder, model string) *YandexOCRClient {
	if key == "" || folder == "" {
		return nil
	}
	if model == "" {
		model = "math-markdown"
	}
	return &YandexOCRClient{
		APIKey:   key,
		FolderID: folder,
		Model:    model,
		HTTP:     &http.Client{Timeout: 90 * time.Second},
	}
}

func (y *YandexOCRClient) ocrPage(ctx context.Context, imagePath string) (string, error) {
	raw, err := os.ReadFile(imagePath)
	if err != nil {
		return "", err
	}
	mime := "image/jpeg"
	if strings.HasSuffix(strings.ToLower(imagePath), ".png") {
		mime = "image/png"
	}
	body, err := json.Marshal(map[string]any{
		"mimeType":      mime,
		"languageCodes": []string{"ru", "en"},
		"model":         y.Model,
		"content":       base64.StdEncoding.EncodeToString(raw),
	})
	if err != nil {
		return "", err
	}

	policy := retryAnyFailure
	policy.attempts = yandexOCRAttempts
	header := map[string]string{"Authorization": "Api-Key " + y.APIKey, "x-folder-id": y.FolderID}
	status, data, err := policy.do(ctx, func(ctx context.Context) (int, []byte, error) {
		return postJSON(ctx, y.HTTP, yandexOCRRecognizeURL, body, header)
	})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("OCR: HTTP %d", status)
	}
	var env struct {
		Result struct {
			TextAnnotation struct {
				FullText string `json:"fullText"`
			} `json:"textAnnotation"`
		} `json:"result"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return "", fmt.Errorf("ai(yandex-ocr): ответ не разобран: %w", err)
	}
	return strings.TrimSpace(env.Result.TextAnnotation.FullText), nil
}

func (y *YandexOCRClient) TranscribeSubmission(ctx context.Context, images []string) (string, error) {
	if y == nil {
		return "", ErrNotConfigured
	}
	if len(images) == 0 {
		return "", ErrNoPages
	}
	out := eachPage("AI: Яндекс-OCR страницы", len(images), 2, func(i int) (string, error) {
		return y.ocrPage(ctx, images[i])
	})

	var sb strings.Builder
	for i, r := range out {
		fmt.Fprintf(&sb, "\n--- Страница %d ---\n", i+1)
		if r.err != nil {
			return "", fmt.Errorf("страница %d: %w", i+1, r.err)
		}
		if strings.TrimSpace(r.text) == "" {
			return "", fmt.Errorf("страница %d не распознана", i+1)
		}
		sb.WriteString(r.text)
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String()), nil
}
