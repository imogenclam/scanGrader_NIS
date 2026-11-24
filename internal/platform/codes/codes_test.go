package codes

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestNewAlphabetAndLength(t *testing.T) {
	seen := map[string]bool{}
	counts := map[rune]int{}
	for i := 0; i < 5000; i++ {
		code := New(Short)
		if len(code) != Short {
			t.Fatalf("длина %d: %q", len(code), code)
		}
		for _, c := range code {
			if !strings.ContainsRune(Alphabet, c) {
				t.Fatalf("чужой символ %q в %q", c, code)
			}
			counts[c]++
		}
		seen[code] = true
	}
	if len(seen) < 4990 {
		t.Errorf("слишком много повторов: уникальных %d из 5000", len(seen))
	}
	// 30000 символов на 31 букву, около 970 на каждую
	for _, c := range Alphabet {
		if counts[c] < 750 || counts[c] > 1200 {
			t.Errorf("буква %q встретилась %d раз", c, counts[c])
		}
	}
	if got := New(12); len(got) != 12 {
		t.Errorf("New(12) длиной %d", len(got))
	}
}

func TestAlphabetHasNoLookalikes(t *testing.T) {
	for _, bad := range "O0I1Ll" {
		if strings.ContainsRune(Alphabet, bad) {
			t.Fatalf("в алфавите путаемый символ %q", bad)
		}
	}
}

// подсказка студенту про неверный код берёт алфавит из фронта
func TestAlphabetMatchesFrontend(t *testing.T) {
	src, err := os.ReadFile("../../../web/src/classroom/joinCode.ts")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(src), "'"+Alphabet+"'") {
		t.Fatal("алфавит кодов на фронте не совпадает с серверным")
	}
}

func TestUniqueSkipsTakenCodes(t *testing.T) {
	var tried []string
	code, err := Unique(Short, func(c string) (bool, error) {
		tried = append(tried, c)
		return len(tried) < 3, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(tried) != 3 || code != tried[2] {
		t.Fatalf("ждали третий код после двух занятых: %q, пробы %v", code, tried)
	}
}

func TestUniqueGivesUp(t *testing.T) {
	n := 0
	_, err := Unique(Short, func(string) (bool, error) { n++; return true, nil })
	if !errors.Is(err, ErrNoFreeCode) || n != Tries {
		t.Fatalf("err=%v, попыток %d, ждали ErrNoFreeCode после %d", err, n, Tries)
	}
}

func TestUniquePassesDBError(t *testing.T) {
	boom := errors.New("база недоступна")
	if _, err := Unique(Short, func(string) (bool, error) { return false, boom }); !errors.Is(err, boom) {
		t.Fatalf("сбой проверки потерян: %v", err)
	}
}
