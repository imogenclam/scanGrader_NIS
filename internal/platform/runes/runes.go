// Package runes обрезает строки по символам: байтовая обрезка s[:n] рвёт кириллицу и формулы.
package runes

// Cut — первые n символов s.
func Cut(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Shorten — как Cut, но отрезанное заменяет «…».
func Shorten(s string, n int) string {
	if cut := Cut(s, n); cut != s {
		return cut + "…"
	}
	return s
}
