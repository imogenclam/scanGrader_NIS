// Package codes выпускает короткие коды: занятия, предмета, соведущего, приглашения в друзья.
package codes

import (
	cryptorand "crypto/rand"
	"errors"
)

// Alphabet без O, 0, I, 1, L; фронт подсказывает по той же строке (joinCode.ts)
const Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// длина кода занятия и кода предмета
const Short = 6

// Tries — сколько раз Unique пробует новый код, прежде чем сдаться.
const Tries = 5

var ErrNoFreeCode = errors.New("codes: не нашлось свободного кода")

// байт выше этого предела отбрасываем, чтобы буквы выпадали поровну
const unbiased = 256 - 256%len(Alphabet)

// New — случайный код из n символов Alphabet.
func New(n int) string {
	out := make([]byte, 0, n)
	buf := make([]byte, n)
	for len(out) < n {
		if _, err := cryptorand.Read(buf); err != nil {
			panic(err)
		}
		for _, b := range buf {
			if int(b) < unbiased && len(out) < n {
				out = append(out, Alphabet[int(b)%len(Alphabet)])
			}
		}
	}
	return string(out)
}

// Unique — код, который taken не считает занятым; после Tries совпадений ErrNoFreeCode.
func Unique(n int, taken func(code string) (bool, error)) (string, error) {
	for range Tries {
		code := New(n)
		busy, err := taken(code)
		if err != nil {
			return "", err
		}
		if !busy {
			return code, nil
		}
	}
	return "", ErrNoFreeCode
}
