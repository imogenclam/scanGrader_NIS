package runes

import "testing"

func TestCutAndShorten(t *testing.T) {
	cases := []struct{ in, cut, short string }{
		{"Привет", "При", "При…"},
		{"При", "При", "При"},
		{"$x^2$", "$x^", "$x^…"},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := Cut(c.in, 3); got != c.cut {
			t.Errorf("Cut(%q) = %q, want %q", c.in, got, c.cut)
		}
		if got := Shorten(c.in, 3); got != c.short {
			t.Errorf("Shorten(%q) = %q, want %q", c.in, got, c.short)
		}
	}
}
