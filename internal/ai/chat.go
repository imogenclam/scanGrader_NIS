package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type ChatClient struct {
	APIKey, BaseURL, Model string
	HTTP                   *http.Client
}

func (c *ChatClient) chat(ctx context.Context, model string, messages []map[string]string, maxTokens int) (string, error) {
	body, err := json.Marshal(map[string]any{
		"model":       model,
		"temperature": 0,
		"max_tokens":  maxTokens,
		"messages":    messages,
	})
	if err != nil {
		return "", err
	}
	status, data, err := retryAnyFailure.do(ctx, func(ctx context.Context) (int, []byte, error) {
		return postJSON(ctx, c.HTTP, c.BaseURL+"/chat/completions", body, map[string]string{"Authorization": "Bearer " + c.APIKey})
	})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("модель проверки: HTTP %d", status)
	}
	var env struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return "", fmt.Errorf("модель проверки: ответ не разобран: %w", err)
	}
	if len(env.Choices) == 0 {
		return "", fmt.Errorf("модель проверки: пустой ответ")
	}
	return env.Choices[0].Message.Content, nil
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "```") {
		s = strings.ReplaceAll(s, "```json", "")
		s = strings.ReplaceAll(s, "```", "")
	}
	start := strings.Index(s, "{")
	if start < 0 {
		return s
	}
	depth, inStr, esc := 0, false, false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inStr {
			switch {
			case esc:
				esc = false
			case c == '\\':
				esc = true
			case c == '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return s[start:]
}
