package ai

import (
	"encoding/json"
	"scangrader/internal/platform/runes"
	"strings"
	"testing"
)

func TestRepairLaTeXJSON_InvalidEscapes(t *testing.T) {
	raw := `{"comment":"Неверно: $\sqrt{2}$, нужно $\alpha \cdot \pi$"}`
	var got struct {
		Comment string `json:"comment"`
	}
	if err := json.Unmarshal([]byte(raw), &got); err == nil {
		t.Fatal("ожидали, что сырой JSON с LaTeX не разберётся")
	}
	if err := unmarshalAI(raw, &got); err != nil {
		t.Fatalf("unmarshalAI: %v", err)
	}
	want := `Неверно: $\sqrt{2}$, нужно $\alpha \cdot \pi$`
	if got.Comment != want {
		t.Errorf("got %q, want %q", got.Comment, want)
	}
}

func TestRepairLaTeXJSON_ControlCharCommands(t *testing.T) {
	cases := map[string]string{
		`{"comment":"$\frac{1}{2}$"}`:          `$\frac{1}{2}$`,
		`{"comment":"$2\times 3$"}`:            `$2\times 3$`,
		`{"comment":"$\nu = 1$"}`:              `$\nu = 1$`,
		`{"comment":"$\beta$"}`:                `$\beta$`,
		`{"comment":"$x\rightarrow 0$"}`:       `$x\rightarrow 0$`,
		`{"comment":"$\theta$ и $\forall x$"}`: `$\theta$ и $\forall x$`,
	}
	for raw, want := range cases {
		var got struct {
			Comment string `json:"comment"`
		}
		if err := unmarshalAI(raw, &got); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if got.Comment != want {
			t.Errorf("%s -> %q, want %q", raw, got.Comment, want)
		}
		if strings.ContainsAny(got.Comment, "\x08\x09\x0a\x0c\x0d") {
			t.Errorf("%s: в тексте остался управляющий символ", raw)
		}
	}
}

func TestRepairLaTeXJSON_KeepsValidJSON(t *testing.T) {
	raw := `{"a":"строка1\nстрока2","b":"$\\frac{1}{2}$","c":"кавычка \" и слэш \\\\","d":"З"}`
	var got map[string]string
	if err := unmarshalAI(raw, &got); err != nil {
		t.Fatalf("unmarshalAI: %v", err)
	}
	if got["a"] != "строка1\nстрока2" {
		t.Errorf("перенос строки потерян: %q", got["a"])
	}
	if got["b"] != `$\frac{1}{2}$` {
		t.Errorf("корректно экранированная формула испорчена: %q", got["b"])
	}
	if got["c"] != `кавычка " и слэш \\` {
		t.Errorf("кавычки/слэши испорчены: %q", got["c"])
	}
	if got["d"] != "З" {
		t.Errorf("\\u-экранирование испорчено: %q", got["d"])
	}
}

func TestTruncateRuneSafe(t *testing.T) {
	s := strings.Repeat("я", 300)
	out := runes.Shorten(s, 200)
	for _, r := range out {
		if r == '�' {
			t.Fatalf("обрезка порвала кириллицу: %q", out)
		}
	}
}

func TestRepairLaTeXJSON_UCommands(t *testing.T) {
	for _, cmd := range []string{`\underline{x}`, `\uparrow`, `\upsilon`} {
		raw := `{"comment":"$` + cmd + `$ и \u0417"}`
		var got struct {
			Comment string `json:"comment"`
		}
		if err := unmarshalAI(raw, &got); err != nil {
			t.Fatalf("%s: %v", cmd, err)
		}
		if want := "$" + cmd + "$ и З"; got.Comment != want {
			t.Errorf("%s -> %q, want %q", cmd, got.Comment, want)
		}
	}
}
