package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"scangrader/internal/ai"
	"scangrader/internal/classroom/classroomstore"
	"scangrader/internal/grading"
	"scangrader/internal/platform/ratelimit"
	"scangrader/internal/storage"
)

type reviewFunc func(context.Context, string, string, string, string, []grading.Task) ([]grading.Grade, error)

type App struct {
	db           *sql.DB
	classroom    classroomstore.ClassroomRepo
	files        string
	secureCookie bool
	limit        *ratelimit.Limiter
	auth         accountAccess
	review       reviewFunc
	unsaved      []reviewResult // только у единственного обработчика очереди
	wake         chan struct{}
	cancel       context.CancelFunc
	wg           sync.WaitGroup
}

func Open(dir string, secure bool) (*App, error) {
	files := filepath.Join(dir, "files")
	if err := os.MkdirAll(files, 0700); err != nil {
		return nil, err
	}
	db, err := storage.Open(filepath.Join(dir, "scangrader.db"))
	if err != nil {
		return nil, err
	}
	auth, err := openAccountAccess(dir)
	if err != nil {
		db.Close()
		return nil, err
	}
	a := &App{db: db, classroom: classroomstore.ClassroomRepo{DB: db}, files: files, secureCookie: secure, limit: ratelimit.New(25, 5*time.Minute, 5*time.Minute), auth: auth, wake: make(chan struct{}, 1)}
	if p := ai.FromEnv(); p != nil {
		a.review = p.Review
	}
	return a, nil
}

func (a *App) Close() {
	if a.cancel != nil {
		a.cancel()
		a.wg.Wait()
	}
	a.limit.Stop()
	a.auth.close()
	a.db.Close()
}

type fault struct {
	code    int
	message string
}

func (e *fault) Error() string          { return e.message }
func reject(code int, msg string) error { return &fault{code, msg} }
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func sendError(w http.ResponseWriter, err error) {
	var e *fault
	if errors.As(err, &e) {
		writeJSON(w, e.code, map[string]string{"error": e.message})
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Запись не найдена"})
		return
	}
	slog.Error("обработка запроса", "err", err)
	writeJSON(w, 500, map[string]string{"error": "Не удалось обработать запрос"})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return reject(400, "Проверьте поля запроса")
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return reject(400, "Ожидается один объект JSON")
	}
	return nil
}
func itemID(r *http.Request) (int, error) {
	n, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || n < 1 {
		return 0, reject(404, "Запись не найдена")
	}
	return n, nil
}

type handler func(http.ResponseWriter, *http.Request, User) error

func (a *App) endpoint(requireUser bool, fn handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var u User
		if requireUser {
			var err error
			u, err = a.current(r)
			if err != nil {
				sendError(w, err)
				return
			}
		}
		if err := fn(w, r, u); err != nil {
			sendError(w, err)
		}
	}
}

func (a *App) Routes(front http.Handler) http.Handler {
	mux := http.NewServeMux()
	public := func(route string, h handler) { mux.HandleFunc(route, a.endpoint(false, h)) }
	private := func(route string, h handler) { mux.HandleFunc(route, a.endpoint(true, h)) }
	public("POST /api/register", a.register)
	public("POST /api/verify-email", a.verifyEmail)
	public("POST /api/auth/check", a.checkLogin)
	public("POST /api/login", a.login)
	public("POST /api/password/forgot", a.forgotPassword)
	public("POST /api/password/reset", a.resetPassword)
	public("POST /logout", a.logout)
	private("POST /api/logout", a.logout)
	private("GET /api/me", func(w http.ResponseWriter, r *http.Request, u User) error { writeJSON(w, 200, u); return nil })
	private("GET /api/profile", a.readProfile)
	private("PUT /api/profile", a.profile)
	private("GET /api/subjects", a.subjects)
	private("POST /api/subjects", a.createSubject)
	private("POST /api/subjects/join", a.join)
	private("GET /api/subjects/{id}", a.subject)
	private("POST /api/subjects/{id}/assignments", a.publish)
	private("GET /api/assignments/{id}", a.assignment)
	private("GET /api/assignments/{id}/reference", a.reference)
	private("POST /api/assignments/{id}/submissions", a.submit)
	private("GET /api/submissions/{id}", a.submission)
	private("GET /api/submissions/{id}/pdf", a.original)
	private("POST /api/submissions/{id}/approve", a.approve)
	private("POST /api/submissions/{id}/retry", a.retryReview)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := storage.Healthy(r.Context(), a.db); err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	mux.Handle("GET /", front)
	protected := http.NewCrossOriginProtection().Handler(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		protected.ServeHTTP(w, r)
	})
}
