package server

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Добавляем сроки в заголовки тестового ответа и применяем их к соединению.
type uploadDeadlineWriter struct {
	http.ResponseWriter
	start time.Time
}

func (w *uploadDeadlineWriter) SetReadDeadline(d time.Time) error {
	w.Header().Set("X-Test-Read-Deadline", d.Sub(w.start).String())
	return http.NewResponseController(w.ResponseWriter).SetReadDeadline(d)
}

func (w *uploadDeadlineWriter) SetWriteDeadline(d time.Time) error {
	w.Header().Set("X-Test-Write-Deadline", d.Sub(w.start).String())
	return http.NewResponseController(w.ResponseWriter).SetWriteDeadline(d)
}

func delayedBody(data []byte) io.ReadCloser {
	reader, writer := io.Pipe()
	go func() {
		defer writer.Close()
		if _, err := writer.Write(data[:len(data)/2]); err != nil {
			return
		}
		time.Sleep(400 * time.Millisecond) // Истекают оба обычных срока.
		writer.Write(data[len(data)/2:])
	}()
	return reader
}

func TestSubmissionUploadDeadlines(t *testing.T) {
	t.Setenv("SG_SMTP_HOST", "")
	app, err := Open(t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	_, err = app.db.Exec(`INSERT INTO users(id,login,login_key,password_hash,role,full_name) VALUES
		(1,'teacher','teacher','test','teacher','Teacher'),
		(2,'student','student','test','student','Student'),
		(3,'guest','guest','test','student','Guest');
		INSERT INTO subjects(id,title,invite_code,created_by) VALUES(1,'Course','ABC123',1);
		INSERT INTO subject_students(subject_id,student_id) VALUES(1,2);
		INSERT INTO assignments(id,subject_id,title,statement,tasks,reference_file,reference_version)
			VALUES(1,1,'Assignment 1','Question','[]','reference.tex','v1'),
				(2,1,'Assignment 2','Question','[]','reference.tex','v1'),
				(3,1,'Assignment 3','Question','[]','reference.tex','v1')`)
	if err != nil {
		t.Fatal(err)
	}
	cookies := map[int]*http.Cookie{}
	for _, id := range []int{1, 2, 3} {
		token, err := newSession(t.Context(), app.db, id, "test")
		if err != nil {
			t.Fatal(err)
		}
		cookies[id] = &http.Cookie{Name: sessionCookie, Value: token}
	}

	routes := app.Routes(http.NotFoundHandler())
	site := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		routes.ServeHTTP(&uploadDeadlineWriter{ResponseWriter: w, start: time.Now()}, r)
	}))
	site.Config.ReadTimeout = 150 * time.Millisecond
	site.Config.WriteTimeout = 250 * time.Millisecond
	site.Start()
	t.Cleanup(site.Close)
	client := site.Client()
	client.Timeout = 10 * time.Second
	const submit = "/api/assignments/1/submissions"

	for _, tc := range []struct {
		name, path string
		user, want int
	}{
		{"ordinary JSON", "/api/auth/check", 2, 200},
		{"no session", submit, 0, 401},
		{"teacher", submit, 1, 403},
		{"not enrolled", submit, 3, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodPost, site.URL+tc.path, strings.NewReader(`{"login":"student"}`))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", "application/json")
			if tc.user != 0 {
				req.AddCookie(cookies[tc.user])
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			read, write := res.Header.Get("X-Test-Read-Deadline"), res.Header.Get("X-Test-Write-Deadline")
			if res.StatusCode != tc.want || read != "" || write != "" {
				t.Fatalf("status %d, deadlines %q / %q", res.StatusCode, read, write)
			}
		})
	}

	typ, form := uploadBody(t, nil, "file", "work.pdf", syntheticPDF(t, 1))
	t.Run("writer without deadline support", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/assignments/3/submissions", bytes.NewReader(form))
		req.Header.Set("Content-Type", typ)
		req.AddCookie(cookies[2])
		recorder := httptest.NewRecorder()
		routes.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("submission to in-memory handler: %d %s", recorder.Code, recorder.Body)
		}
	})
	for _, tc := range []struct {
		name, path       string
		length           int64
		minRead, maxRead time.Duration
	}{
		{"known size PDF", submit, int64(len(form)), time.Minute, 70 * time.Second},
		{"chunked PDF", "/api/assignments/2/submissions", -1, 14 * time.Minute, 16 * time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodPost, site.URL+tc.path, delayedBody(form))
			if err != nil {
				t.Fatal(err)
			}
			req.ContentLength = tc.length
			req.Header.Set("Content-Type", typ)
			req.AddCookie(cookies[2])
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil || res.StatusCode != http.StatusCreated {
				t.Fatalf("slow submission: %d %s, %v", res.StatusCode, body, err)
			}
			read, err := time.ParseDuration(res.Header.Get("X-Test-Read-Deadline"))
			if err != nil || read < tc.minRead || read > tc.maxRead {
				t.Fatalf("read deadline %s, %v", read, err)
			}
			write, err := time.ParseDuration(res.Header.Get("X-Test-Write-Deadline"))
			if err != nil || write < read+90*time.Second || write > read+3*time.Minute {
				t.Fatalf("write deadline %s, read deadline %s, %v", write, read, err)
			}
		})
	}

	t.Run("slow JSON after PDF", func(t *testing.T) {
		res, err := client.Post(site.URL+"/api/auth/check", "application/json", delayedBody([]byte(`{"login":"student"}`)))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("ordinary request exceeded its read deadline with status %d", res.StatusCode)
		}
	})
}
