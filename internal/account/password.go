package account

import (
	"log/slog"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const PasswordHashCost = 12

var hashCost = PasswordHashCost

const (
	passwordMinRunes = 8
	passwordMaxBytes = 72
)

func PasswordLengthError(pw string) string {
	if utf8.RuneCountInString(pw) < passwordMinRunes {
		return "Пароль должен быть не короче 8 символов"
	}
	if len(pw) > passwordMaxBytes {
		return "Пароль слишком длинный (не более 72 байт)"
	}
	return ""
}

// лениво: помощник PDF стартует на каждую склейку
var dummyPasswordHash = sync.OnceValue(func() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("dummy-password-for-timing"), PasswordHashCost)
	if err != nil {
		slog.Error("пустой хэш пароля", "err", err)
	}
	return h
})

func HashPassword(password string) ([]byte, error) {
	return bcrypt.GenerateFromPassword([]byte(password), hashCost)
}

func CheckPassword(hash string, password string) bool {
	if hash == "" {
		bcrypt.CompareHashAndPassword(dummyPasswordHash(), []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
