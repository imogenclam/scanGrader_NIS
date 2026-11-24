package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"scangrader/src/api"
	"scangrader/src/storage"
)

const submission = "/api/submissions/1"
const approve = submission + "/approve"
const valid = `{"grades":[{"number":1,"score":0.7,"comment":"Арифметическая ошибка"}]}`

func request(h http.Handler, method, path, token, body, contentType string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("X-Role", "teacher")
	r.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func response(t *testing.T, w *httptest.ResponseRecorder, code int) map[string]any {
	t.Helper()
	if w.Code != code {
		t.Fatalf("HTTP %d, want %d: %s", w.Code, code, w.Body.String())
	}
	var data map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func open(t *testing.T, dir string) *storage.Store {
	t.Helper()
	s, err := storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func token(t *testing.T, s *storage.Store, role string) string {
	t.Helper()
	value, err := s.DemoToken(t.Context(), role)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestReviewIsPrivateUntilApprovedAndSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	h := api.New(s)
	student, teacher := token(t, s, "student"), token(t, s, "teacher")
	get := func(path, credential string, code int) map[string]any {
		return response(t, request(h, "GET", path, credential, "", ""), code)
	}
	post := func(credential, body string, code int) map[string]any {
		return response(t, request(h, "POST", approve, credential, body, "application/json"), code)
	}

	if health := get("/healthz", "", 200); health["status"] != "ok" {
		t.Fatal(health)
	}
	get(submission, "", 401)
	get(submission, "unrecognized", 401)
	get("/api/submissions/999", teacher, 404)
	response(t, request(h, "POST", "/api/submissions/999/approve", teacher, valid, "application/json"), 404)
	post(student, valid, 403)

	draft := get(submission, teacher, 200)
	wantRows := []any{map[string]any{"number": 1.0, "score": 0.5, "comment": "Проверьте вычисление."}}
	if !reflect.DeepEqual(draft["draft"], wantRows) || !reflect.DeepEqual(draft["tasks"], []any{map[string]any{"number": 1.0, "max": 1.0}}) {
		t.Fatalf("teacher draft: %v", draft)
	}
	waiting := map[string]any{"id": 1.0, "status": "pending_review"}
	if view := get(submission, student, 200); !reflect.DeepEqual(view, waiting) {
		t.Fatalf("unpublished result: %v", view)
	}
	for _, body := range []string{
		strings.Replace(valid, "0.7", "1.2", 1),
		`{"grades":[{"number":1,"comment":"Пояснение"}]}`,
		`{"grades":[{"number":1,"score":0,"comment":"  "}]}`,
		`{"grades":[]}`,
		`{"grades":[],"role":"teacher"}`,
		valid + ` {}`,
	} {
		if err, ok := post(teacher, body, 400)["error"].(string); !ok || err == "" {
			t.Fatalf("missing validation message for %s", body)
		}
	}
	response(t, request(h, "POST", approve, teacher, valid, "text/plain"), 415)
	response(t, request(h, "POST", approve, teacher, strings.Repeat(" ", 1<<20)+valid, "application/json"), 413)
	if view := get(submission, student, 200); !reflect.DeepEqual(view, waiting) {
		t.Fatalf("rejected grade published: %v", view)
	}

	final := post(teacher, valid, 200)
	wantGrades := []any{map[string]any{"number": 1.0, "score": 0.7, "comment": "Арифметическая ошибка"}}
	if final["status"] != "approved" || final["approved_by"] != "teacher-demo" || final["total"] != 0.7 || !reflect.DeepEqual(final["grades"], wantGrades) {
		t.Fatalf("approved result: %v", final)
	}
	if _, err := time.Parse(time.RFC3339, final["approved_at"].(string)); err != nil {
		t.Fatal(err)
	}
	if _, ok := final["draft"]; ok {
		t.Fatal("draft in final result")
	}
	if _, ok := final["tasks"]; ok {
		t.Fatal("tasks in final result")
	}
	post(teacher, valid, 409)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	h = api.New(open(t, dir))
	if after := get(submission, student, 200); !reflect.DeepEqual(final, after) {
		t.Fatalf("after restart: %v, want %v", after, final)
	}
	if after := get(submission, teacher, 200); !reflect.DeepEqual(after["draft"], draft["draft"]) {
		t.Fatalf("approval changed draft: %v", after)
	}
}

func TestOnlyOneConcurrentApprovalWins(t *testing.T) {
	s := open(t, t.TempDir())
	h := api.New(s)
	teacher := token(t, s, "teacher")
	student := token(t, s, "student")
	begin := make(chan struct{})
	type result struct {
		score float64
		reply *httptest.ResponseRecorder
	}
	results := make(chan result, 2)
	submit := func(score float64, body string) {
		<-begin
		results <- result{score, request(h, "POST", approve, teacher, body, "application/json")}
	}
	go submit(0.7, valid)
	go submit(0.3, strings.Replace(valid, "0.7", "0.3", 1))
	close(begin)
	winner, conflict := <-results, <-results
	if conflict.reply.Code == http.StatusOK {
		winner, conflict = conflict, winner
	}
	final := response(t, winner.reply, http.StatusOK)
	response(t, conflict.reply, http.StatusConflict)
	visible := response(t, request(h, "GET", submission, student, "", ""), http.StatusOK)
	if final["total"] != winner.score || !reflect.DeepEqual(visible, final) {
		t.Fatalf("student sees %v, winning approval for %v points returned %v", visible, winner.score, final)
	}
}
