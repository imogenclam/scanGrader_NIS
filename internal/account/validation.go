package account

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var loginRegex = regexp.MustCompile(`^[a-zA-Z0-9а-яА-ЯёЁ._\-]+$`)

func hasHiddenChars(fields ...string) bool {
	for _, s := range fields {
		for _, r := range s {
			if unicode.IsControl(r) || unicode.Is(unicode.Bidi_Control, r) {
				return true
			}
		}
	}
	return false
}

func ValidLogin(s string) bool {
	n := utf8.RuneCountInString(s)
	return n >= 3 && n <= 30 && loginRegex.MatchString(s)
}

func ValidProfile(name, group string) bool {
	return strings.TrimSpace(name) != "" && utf8.RuneCountInString(name) <= 120 &&
		utf8.RuneCountInString(group) <= 40 && !hasHiddenChars(name, group)
}
