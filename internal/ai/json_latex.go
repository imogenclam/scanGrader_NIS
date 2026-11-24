package ai

import (
	"encoding/json"
	"strings"
)

// Модели часто пишут формулы в JSON одним слэшем: $\sqrt2$, $\frac12$.
// \sqrt ломает разбор целиком, а \frac, \times, \nu, \beta молча
// превращаются в управляющие символы. Чиним до json.Unmarshal.

// команды LaTeX, совпадающие с началом JSON-экранирования; длинные раньше коротких
var latexAfterEscape = map[byte][]string{
	'b': {"boldsymbol", "bigcup", "bigcap", "begin", "binom", "bullet", "bigg", "beta", "bmod", "big", "bar", "bf"},
	'f': {"forall", "floor", "frac", "fbox"},
	'n': {"nrightarrow", "nparallel", "nsubseteq", "nabla", "notin", "nmid", "not", "neq", "nu", "ne"},
	'r': {"rightarrow", "rangle", "rfloor", "rceil", "right", "rho"},
	't': {"textbf", "tbinom", "theta", "tilde", "times", "tanh", "tfrac", "text", "tan", "top", "tau", "to"},
}

func isASCIILetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isHex4(s string) bool {
	if len(s) < 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		c := s[i]
		if !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f') && !(c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

func latexCommandAt(first byte, rest string) (string, bool) {
	for _, cmd := range latexAfterEscape[first] {
		if !strings.HasPrefix(rest, cmd) {
			continue
		}
		if len(rest) == len(cmd) || !isASCIILetter(rest[len(cmd)]) {
			return cmd, true
		}
	}
	return "", false
}

// repairLaTeXJSON удваивает одиночные слэши формул внутри строк JSON.
func repairLaTeXJSON(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 32)
	inStr := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !inStr {
			b.WriteByte(c)
			if c == '"' {
				inStr = true
			}
			continue
		}
		if c == '"' {
			inStr = false
			b.WriteByte(c)
			continue
		}
		if c != '\\' {
			b.WriteByte(c)
			continue
		}
		if i+1 >= len(s) {
			b.WriteString(`\\`)
			continue
		}
		n := s[i+1]
		switch n {
		case 'u':
			if !isHex4(s[i+2:]) {
				// \underline, \uparrow, \upsilon
				b.WriteString(`\\`)
			} else {
				b.WriteByte(c)
			}
			b.WriteByte(n)
			i++
		case '"', '\\', '/':
			b.WriteByte(c)
			b.WriteByte(n)
			i++
		case 'b', 'f', 'n', 'r', 't':
			if cmd, ok := latexCommandAt(n, s[i+1:]); ok {
				b.WriteString(`\\`)
				b.WriteString(cmd)
				i += len(cmd)
				continue
			}
			b.WriteByte(c)
			b.WriteByte(n)
			i++
		default:
			// недопустимое экранирование JSON — значит LaTeX
			b.WriteString(`\\`)
			b.WriteByte(n)
			i++
		}
	}
	return b.String()
}

// unmarshalAI разбирает ответ модели, сначала починив формулы.
func unmarshalAI(raw string, v any) error {
	if fixed := repairLaTeXJSON(raw); fixed != raw {
		if err := json.Unmarshal([]byte(fixed), v); err == nil {
			return nil
		}
	}
	return json.Unmarshal([]byte(raw), v)
}
