package account

import (
	"fmt"
	"net/mail"
	"strings"
	"unicode"
	"unicode/utf8"
)

// RegisterRequest — анкета VisualMath. Старые клиенты Scan Grader называют группу group.
type RegisterRequest struct {
	Login         string `json:"login"`
	Password      string `json:"password"`
	FullName      string `json:"full_name"`
	UserType      string `json:"user_type"`
	GroupNumber   string `json:"group_number"`
	Group         string `json:"group"`
	Email         string `json:"email"`
	RequestedRole string `json:"requested_role"`
	TeacherNote   string `json:"teacher_note"`
}

func (f *RegisterRequest) Normalize() {
	f.Login = strings.TrimSpace(f.Login)
	f.Email = strings.ToLower(strings.TrimSpace(f.Email))
	f.FullName = strings.TrimSpace(f.FullName)
	if f.GroupNumber == "" {
		f.GroupNumber = f.Group
	}
	f.GroupNumber = strings.TrimSpace(f.GroupNumber)
	f.TeacherNote = strings.TrimSpace(f.TeacherNote)
	f.RequestedRole = strings.ToLower(strings.TrimSpace(f.RequestedRole))
}

func ValidEmail(addr string) bool {
	if len(addr) > 254 || hasHiddenChars(addr) {
		return false
	}
	parsed, err := mail.ParseAddress(addr)
	return err == nil && parsed.Address == addr && strings.Contains(addr, "@")
}

func (f RegisterRequest) Problem() (field, message string) {
	if !ValidLogin(f.Login) {
		return "login", "Логин должен содержать от 3 до 30 букв, цифр или знаков . _ -"
	}
	if strings.HasPrefix(strings.ToLower(f.Login), "deleted") {
		return "login", "Этот логин недоступен, выберите другой"
	}
	if !ValidEmail(f.Email) {
		return "email", "Укажите корректный email"
	}
	if isDisposableEmail(f.Email) {
		return "email", disposableEmailMsg
	}
	if msg := PasswordLengthError(f.Password); msg != "" {
		return "password", msg
	}
	n := utf8.RuneCountInString(f.FullName)
	if n < 2 || n > 100 || !ValidProfile(f.FullName, f.GroupNumber) {
		return "full_name", "Укажите фамилию и имя (от 2 до 100 символов) и группу до 40 символов"
	}
	if f.RequestedRole == "teacher" {
		if n := utf8.RuneCountInString(f.TeacherNote); n < 3 {
			return "teacher_note", "Напишите, где вы преподаёте: вуз, школа или курсы (хотя бы 3 символа)"
		} else if n > 500 {
			return "teacher_note", "«Где преподаёте» слишком длинное, максимум 500 символов"
		}
		if hasHiddenChars(f.TeacherNote) {
			return "teacher_note", "В названии организации не должно быть служебных символов"
		}
	}
	return "", ""
}

// FreeLogins подбирает варианты по правилам VisualMath, сохраняя читаемый суффикс у имён с цифрой.
func FreeLogins(base string, taken func(string) (bool, error)) ([]string, error) {
	r := []rune(base)
	if len(r) > 26 {
		r = r[:26]
	}
	base = string(r)
	sep := ""
	if len(r) > 0 && unicode.IsDigit(r[len(r)-1]) {
		sep = "_"
	}
	candidates := []string{base + sep + "2", base + sep + "3", base + "_26"}
	for i := 4; i < 40; i++ {
		candidate := fmt.Sprintf("%s%s%d", base, sep, i)
		if candidate != base+"_26" {
			candidates = append(candidates, candidate)
		}
	}
	var out []string
	for _, candidate := range candidates {
		busy, err := taken(candidate)
		if err != nil {
			return nil, err
		}
		if !busy {
			out = append(out, candidate)
			if len(out) == 3 {
				break
			}
		}
	}
	return out, nil
}
