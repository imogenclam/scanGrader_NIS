package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"scangrader/internal/account"
)

type User struct {
	ID                   int    `json:"id"`
	Login                string `json:"login"`
	Role                 string `json:"role"`
	FullName             string `json:"full_name"`
	Group                string `json:"group"`
	Email                string `json:"email"`
	TeacherRequestStatus string `json:"teacher_request_status,omitempty"`
}
type credentials struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}
type details struct {
	FullName string `json:"full_name"`
	Group    string `json:"group"`
}

func (d *details) clean() error {
	d.FullName = strings.TrimSpace(d.FullName)
	d.Group = strings.TrimSpace(d.Group)
	if !account.ValidProfile(d.FullName, d.Group) {
		return reject(400, "Укажите ФИО до 120 знаков и группу до 40 знаков")
	}
	return nil
}

func token() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

const sessionCookie = "sg_session"

func (a *App) cookie(w http.ResponseWriter, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: value, Path: "/", MaxAge: age, Secure: a.secureCookie, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

const sessionTTL = 7 * 24 * time.Hour

type sessionDB interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

// Повторная проверка хэша в INSERT не даёт старому паролю открыть сессию после сброса.
func newSession(ctx context.Context, db sessionDB, id int, verifiedHash string) (string, error) {
	key, err := token()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(key))
	res, err := db.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at)
		SELECT ?,id,? FROM users WHERE id=? AND password_hash=?`, digest[:], time.Now().Add(sessionTTL).Unix(), id, verifiedHash)
	if err != nil {
		return "", err
	}
	n, err := res.RowsAffected()
	if err == nil && n != 1 {
		return "", reject(401, "Пароль был изменён. Войдите снова")
	}
	return key, err
}
func (a *App) current(r *http.Request) (User, error) {
	var u User
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return u, reject(401, "Войдите в аккаунт")
	}
	hash := sha256.Sum256([]byte(cookie.Value))
	err = a.db.QueryRowContext(r.Context(), `SELECT u.id,u.login,u.role,u.full_name,u.group_number,u.email,u.teacher_request
		FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`, hash[:], time.Now().Unix()).
		Scan(&u.ID, &u.Login, &u.Role, &u.FullName, &u.Group, &u.Email, &u.TeacherRequestStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return u, reject(401, "Войдите в аккаунт")
	}
	return u, err
}

func (a *App) throttle(r *http.Request, bucket string) error {
	if !a.limit.Acquire(bucket + ":" + clientIP(r)) {
		return reject(429, "Слишком много попыток. Попробуйте через пять минут")
	}
	return nil
}
func (a *App) login(w http.ResponseWriter, r *http.Request, _ User) error {
	if !a.auth.flood.Acquire(clientIP(r)) {
		w.Header().Set("Retry-After", "300")
		return reject(429, "Слишком много запросов входа. Попробуйте через пять минут")
	}
	var b credentials
	if err := decode(w, r, &b); err != nil {
		return err
	}
	ident := normalizedLogin(b.Login)
	if ident == "" || b.Password == "" {
		return reject(400, "Укажите логин или email и пароль")
	}
	pair := loginPair(ident, r)
	if !a.auth.attempts.Acquire(pair) {
		w.Header().Set("Retry-After", "900")
		return reject(429, "Слишком много неудачных попыток входа. Повторите через 15 минут")
	}
	loginKey := "login:" + ident
	if !applyLoginDelay(loginDelay(a.auth.attempts.Touch(loginKey) - 1)) {
		w.Header().Set("Retry-After", "5")
		return reject(429, "Сейчас слишком много попыток входа. Попробуйте через несколько секунд")
	}
	var u User
	var hash string
	err := a.db.QueryRowContext(r.Context(), `SELECT id,login,role,full_name,group_number,email,teacher_request,password_hash
		FROM users WHERE login_key=? OR (email!='' AND email=?)`, ident, ident).
		Scan(&u.ID, &u.Login, &u.Role, &u.FullName, &u.Group, &u.Email, &u.TeacherRequestStatus, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if !account.CheckPassword(hash, b.Password) {
		if errors.Is(err, sql.ErrNoRows) {
			var pending bool
			err = a.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM email_verifications
				WHERE expires_at>? AND instr(email, ':')=0 AND (email=? OR json_extract(data_json,'$.login_key')=?))`,
				time.Now().Unix(), ident, ident).Scan(&pending)
			if err != nil {
				return err
			}
			if pending {
				writeJSON(w, 401, map[string]any{"success": false, "pending_registration": true, "message": "Регистрация не закончена. Введите код из письма."})
				return nil
			}
		}
		return reject(401, "Неверный логин или пароль")
	}
	key, err := newSession(r.Context(), a.db, u.ID, hash)
	if err != nil {
		return err
	}
	a.auth.attempts.RecordSuccess(pair)
	a.auth.attempts.RecordSuccess(loginKey)
	a.cookie(w, key, int(sessionTTL.Seconds()))
	writeJSON(w, 200, struct {
		User
		Success  bool        `json:"success"`
		Message  string      `json:"message"`
		Restored bool        `json:"restored"`
		Profile  profileUser `json:"user"`
	}{u, true, "Вход выполнен успешно", false, profileOf(u)})
	return nil
}
func (a *App) logout(w http.ResponseWriter, r *http.Request, _ User) error {
	c, err := r.Cookie(sessionCookie)
	if err != nil && !errors.Is(err, http.ErrNoCookie) {
		return err
	}
	if c != nil {
		hash := sha256.Sum256([]byte(c.Value))
		if _, err = a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", hash[:]); err != nil {
			return err
		}
	}
	a.cookie(w, "", -1)
	w.WriteHeader(204)
	return nil
}

type profileUser struct {
	User
	UserType    string `json:"user_type"`
	GroupNumber string `json:"group_number"`
}

func profileOf(u User) profileUser { return profileUser{u, u.Role, u.Group} }

func (a *App) readProfile(w http.ResponseWriter, r *http.Request, u User) error {
	writeJSON(w, 200, profileOf(u))
	return nil
}
func (a *App) profile(w http.ResponseWriter, r *http.Request, u User) error {
	var d details
	if err := decode(w, r, &d); err != nil {
		return err
	}
	if err := d.clean(); err != nil {
		return err
	}
	if _, err := a.db.ExecContext(r.Context(), "UPDATE users SET full_name=?,group_number=? WHERE id=?", d.FullName, d.Group, u.ID); err != nil {
		return err
	}
	u.FullName, u.Group = d.FullName, d.Group
	writeJSON(w, 200, u)
	return nil
}

// SeedTeacher возвращает разовый пароль только при первом успешном создании.
func (a *App) SeedTeacher() (string, error) {
	var role string
	err := a.db.QueryRow("SELECT role FROM users WHERE login_key='teacher'").Scan(&role)
	if err == nil {
		if role != "teacher" {
			return "", fmt.Errorf("логин teacher занят")
		}
		return "", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	pass, err := token()
	if err != nil {
		return "", err
	}
	hash, err := account.HashPassword(pass)
	if err != nil {
		return "", err
	}
	res, err := a.db.Exec(`INSERT INTO users(login,login_key,password_hash,role,full_name) VALUES ('teacher','teacher',?,'teacher','Преподаватель') ON CONFLICT(login_key) DO NOTHING`, string(hash))
	if err != nil {
		return "", err
	}
	n, err := res.RowsAffected()
	if err != nil || n == 0 {
		return "", err
	}
	return pass, nil
}
