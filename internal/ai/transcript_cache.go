package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Меняется вместе с форматом страниц или параметрами запроса к OCR.
const transcriptFormat = "yandex-vision-v1/pdf-ru-en/v1"
const maxTranscriptCacheBytes = 32 << 20

type transcriptEntry struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

func transcriptKey(original, model, revision string) (string, error) {
	f, err := os.Open(original)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hash := sha256.New()
	io.WriteString(hash, transcriptFormat+"\x00"+model+"\x00"+revision+"\x00")
	if _, err := io.Copy(hash, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func readTranscript(path, key string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxTranscriptCacheBytes+1))
	if err != nil || len(b) > maxTranscriptCacheBytes {
		return ""
	}
	var saved transcriptEntry
	if json.Unmarshal(b, &saved) != nil || saved.Key != key || strings.TrimSpace(saved.Text) == "" {
		return ""
	}
	return saved.Text
}

func storeTranscript(path, key, text string) error {
	if len(text) > maxTranscriptCacheBytes {
		return nil
	}
	b, err := json.Marshal(transcriptEntry{Key: key, Text: text})
	if err != nil || len(b) > maxTranscriptCacheBytes {
		return err
	}
	// В каталоге сдачи один закрытый файл. Новый текст публикуется только целиком.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".ocr-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(b)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), path)
}
