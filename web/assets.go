package web

import (
	"embed"
	"io/fs"
	"net/http"
	"regexp"
)

//go:embed dist/*
var assets embed.FS

var page = regexp.MustCompile(`^/(?:|login|register|forgot|dashboard|profile|classroom/(?:join|subjects(?:/create|/[1-9][0-9]*(?:/assignments/create)?)?|assignments/[1-9][0-9]*|submissions/[1-9][0-9]*/(?:view|annotate)))/?$`)

// Handler отдаёт React по адресам приложения и раздаёт только открытые ресурсы сборки.
func Handler() http.Handler {
	dir, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if page.MatchString(r.URL.Path) {
			w.Header().Set("Cache-Control", "no-cache")
			req := r.Clone(r.Context())
			req.URL.Path = "/"
			files.ServeHTTP(w, req)
			return
		}
		name := r.URL.Path[1:]
		info, err := fs.Stat(dir, name)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}
