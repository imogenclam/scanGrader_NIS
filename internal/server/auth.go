package server

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"scangrader/internal/account"
	"scangrader/internal/email"
	"scangrader/internal/platform/ratelimit"
)

type accountAccess struct {
	mail       email.Sender
	attempts   *ratelimit.Limiter
	flood      *ratelimit.Limiter
	resetWait  *ratelimit.Limiter
	codeUnlock *ratelimit.Limiter
	codeHourly *ratelimit.Limiter
}

func openAccountAccess(dir string) (accountAccess, error) {
	sender, err := email.FromEnv(dir)
	if err != nil {
		return accountAccess{}, err
	}
	return accountAccess{
		mail: sender, attempts: ratelimit.NewLogin(), flood: ratelimit.New(1200, 10*time.Minute, 5*time.Minute),
		resetWait:  ratelimit.New(1, account.ResendInterval, account.ResendInterval),
		codeUnlock: ratelimit.New(1, time.Minute, time.Minute),
		codeHourly: ratelimit.New(20, time.Hour, time.Hour),
	}, nil
}

func (a accountAccess) close() {
	a.attempts.Stop()
	a.flood.Stop()
	a.resetWait.Stop()
	a.codeUnlock.Stop()
	a.codeHourly.Stop()
}

// Новое письмо снимает блок подбора не чаще раза в минуту. Почасовой лимит продолжает действовать.
func (a accountAccess) unlockCode(key string) {
	key = "code:" + key
	if a.attempts.Count(key) > 0 && a.codeUnlock.Acquire(key) {
		a.attempts.RecordSuccess(key)
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func normalizedLogin(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if len(s) > 254 {
		s = s[:254]
		for !utf8.ValidString(s) {
			s = s[:len(s)-1]
		}
	}
	return s
}

func loginPair(ident string, r *http.Request) string { return "login:" + ident + "|" + clientIP(r) }

func (a *App) checkLogin(w http.ResponseWriter, r *http.Request, _ User) error {
	var req struct {
		Login string `json:"login"`
	}
	if err := decode(w, r, &req); err != nil {
		return err
	}
	if strings.TrimSpace(req.Login) == "" {
		return reject(400, "Укажите логин или email")
	}
	writeJSON(w, 200, map[string]any{"exists": true, "next": "password"})
	return nil
}

func identifierTaken(ctx context.Context, tx *sql.Tx, ident string) (bool, error) {
	ident = strings.ToLower(ident)
	// Начальный teacher нельзя занять до первого запуска -init-teacher.
	if ident == "teacher" {
		return true, nil
	}
	var taken bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE login_key=? OR (email!='' AND email=?))`, ident, ident).Scan(&taken)
	return taken, err
}

type registerProblem struct {
	Success     bool     `json:"success"`
	Field       string   `json:"field"`
	Message     string   `json:"message"`
	Suggestions []string `json:"suggestions,omitempty"`
}

func (p *registerProblem) Error() string { return p.Message }

func registrationConflict(ctx context.Context, tx *sql.Tx, form account.RegisterRequest) error {
	taken := func(value string) (bool, error) { return identifierTaken(ctx, tx, value) }
	emailUsed, err := taken(form.Email)
	if err != nil {
		return err
	}
	if emailUsed {
		return &registerProblem{Field: "email", Message: "На эту почту уже есть аккаунт. Войдите или восстановите пароль."}
	}
	loginUsed, err := taken(form.Login)
	if err != nil || !loginUsed {
		return err
	}
	candidates, err := account.FreeLogins(form.Login, taken)
	if err != nil {
		return err
	}
	return &registerProblem{Field: "login", Message: "Логин «" + form.Login + "» уже занят. Выберите свободный.", Suggestions: candidates}
}

func (a *App) register(w http.ResponseWriter, r *http.Request, _ User) error {
	if err := a.throttle(r, "register"); err != nil {
		return err
	}
	var form account.RegisterRequest
	if err := decode(w, r, &form); err != nil {
		return err
	}
	form.Normalize()
	if field, msg := form.Problem(); msg != "" {
		writeJSON(w, 400, registerProblem{Field: field, Message: msg})
		return nil
	}
	challenge, shouldSend, err := a.prepareRegistration(r.Context(), form)
	var conflict *registerProblem
	if errors.As(err, &conflict) {
		writeJSON(w, 409, conflict)
		return nil
	}
	if err != nil {
		return err
	}
	if shouldSend {
		if err := a.auth.mail.SendVerificationCode(r.Context(), form.Email, challenge.Code); err != nil {
			// Повторно нажать «Продолжить» можно сразу после ошибки доставки.
			_, resetErr := a.db.Exec("UPDATE email_verifications SET sent_at=0 WHERE email=? AND code=? AND sent_at=?", form.Email, challenge.Code, challenge.SentAt)
			if resetErr != nil {
				return resetErr
			}
			slog.Error("доставка письма регистрации", "err", err)
			return reject(503, "Не удалось доставить письмо. Попробуйте ещё раз")
		}
	}
	writeJSON(w, 200, map[string]any{
		"success": true, "need_verify": true, "teacher_request": challenge.Data.TeacherNote != "",
		"local_delivery": a.auth.mail.Local(), "message": "Код подтверждения отправлен на " + form.Email,
	})
	return nil
}

// Блокировка записи SQLite сохраняет первую анкету даже при двух одновременных регистрациях.
func (a *App) prepareRegistration(ctx context.Context, form account.RegisterRequest) (account.Challenge, bool, error) {
	var data account.CodeData
	// Повтор с активным кодом обойдётся без повторного bcrypt.
	for {
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return account.Challenge{}, false, err
		}
		if err := registrationConflict(ctx, tx, form); err != nil {
			tx.Rollback()
			return account.Challenge{}, false, err
		}
		challenge, err := account.LoadCode(ctx, tx, form.Email)
		now := time.Now()
		if err == nil && challenge.ExpiresAt > now.Unix() {
			send := challenge.SentAt <= now.Add(-account.ResendInterval).Unix()
			if send {
				challenge.SentAt = now.Unix()
				_, err = tx.ExecContext(ctx, "UPDATE email_verifications SET sent_at=? WHERE email=?", challenge.SentAt, form.Email)
			}
			if err != nil {
				tx.Rollback()
				return account.Challenge{}, false, err
			}
			return challenge, send, tx.Commit()
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			tx.Rollback()
			return account.Challenge{}, false, err
		}
		if data.PasswordHash != "" {
			challenge, err = account.NewChallenge(data, now)
			if err == nil {
				err = challenge.Save(ctx, tx, form.Email)
			}
			if err != nil {
				tx.Rollback()
				return account.Challenge{}, false, err
			}
			if err := tx.Commit(); err != nil {
				return account.Challenge{}, false, err
			}
			a.auth.unlockCode(form.Email)
			return challenge, true, nil
		}
		tx.Rollback()
		hash, err := account.HashPassword(form.Password)
		if err != nil {
			return account.Challenge{}, false, err
		}
		data = account.CodeData{Login: form.Login, LoginKey: strings.ToLower(form.Login), PasswordHash: string(hash), FullName: form.FullName, GroupNumber: form.GroupNumber}
		if form.RequestedRole == "teacher" {
			data.TeacherNote = form.TeacherNote
		}
	}
}

func (a *App) withMailCode(w http.ResponseWriter, r *http.Request, key, code string, apply func(*sql.Tx, account.CodeData) error) error {
	if !a.auth.flood.Acquire("code:" + clientIP(r)) {
		w.Header().Set("Retry-After", "300")
		return reject(429, "Слишком много запросов проверки кода. Попробуйте через пять минут")
	}
	attemptKey := "code:" + key
	if !a.auth.attempts.Acquire(attemptKey) {
		w.Header().Set("Retry-After", "900")
		return reject(429, "Слишком много неверных кодов. Повторите через 15 минут")
	}
	if !a.auth.codeHourly.Acquire(attemptKey) {
		w.Header().Set("Retry-After", "3600")
		return reject(429, "Слишком много неверных кодов. Повторите через час")
	}
	err := account.WithVerifiedCode(r.Context(), a.db, key, code, apply)
	switch {
	case err == nil:
		a.auth.attempts.RecordSuccess(attemptKey)
		a.auth.codeHourly.RecordSuccess(attemptKey)
	case errors.Is(err, account.ErrCodeMissing), errors.Is(err, account.ErrCodeWrong), errors.Is(err, account.ErrCodeExpired):
		return reject(400, err.Error())
	}
	return err
}

func (a *App) verifyEmail(w http.ResponseWriter, r *http.Request, _ User) error {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := decode(w, r, &req); err != nil {
		return err
	}
	addr := strings.ToLower(strings.TrimSpace(req.Email))
	if !account.ValidEmail(addr) || strings.TrimSpace(req.Code) == "" {
		return reject(400, "Укажите email и код")
	}
	var id int
	var sessionKey string
	role := "student"
	err := a.withMailCode(w, r, addr, req.Code, func(tx *sql.Tx, data account.CodeData) error {
		status := ""
		if data.TeacherNote != "" {
			role, status = "teacher", "approved"
		}
		err := tx.QueryRowContext(r.Context(), `INSERT INTO users(login,login_key,password_hash,role,full_name,group_number,email,teacher_request,teacher_note)
			VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`,
			data.Login, data.LoginKey, data.PasswordHash, role, data.FullName, data.GroupNumber, addr, status, data.TeacherNote).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return reject(409, "Пользователь с таким логином или email уже существует")
		}
		if err != nil {
			return err
		}
		sessionKey, err = newSession(r.Context(), tx, id, data.PasswordHash)
		return err
	})
	if err != nil {
		return err
	}
	a.cookie(w, sessionKey, int(sessionTTL.Seconds()))
	writeJSON(w, 200, map[string]any{"success": true, "message": "Аккаунт создан", "user_id": id, "user_type": role, "teacher_request": false})
	return nil
}
