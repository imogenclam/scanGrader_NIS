package web

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplicationRoutesAndPrivateFiles(t *testing.T) {
	handler := Handler()
	for _, path := range []string{"/", "/register", "/forgot", "/classroom/subjects", "/classroom/subjects/8/assignments/create", "/classroom/submissions/14/annotate", "/classroom/submissions/14/view"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Scan Grader") || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	for _, path := range []string{"/data/files", "/data/mail", "/.env", "/api/unknown", "/assets/", "/assets/missing.js"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 404 {
			t.Errorf("%s: ожидали 404, получили %d", path, rec.Code)
		}
	}
}
