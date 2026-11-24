package server

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"scangrader/internal/account"
	"scangrader/internal/safe"
)

func (a *App) forgotPassword(w http.ResponseWriter, r *http.Request, _ User) error {
	if err := a.throttle(r, "forgot"); err != nil {
		return err
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := decode(w, r, &req); err != nil {
		return err
	}
	addr := strings.ToLower(strings.TrimSpace(req.Email))
	if !account.ValidEmail(addr) {
		return reject(400, "Укажите email")
	}
	// Для неизвестного адреса действует та же пауза, что и для зарегистрированного.
	if !a.auth.resetWait.Acquire(addr) {
		w.Header().Set("Retry-After", "60")
		return reject(429, "Код уже запрошен. Повторить можно через минуту")
	}
	var data account.CodeData
	err := a.db.QueryRowContext(r.Context(), "SELECT id,login FROM users WHERE email=? AND email!=''", addr).Scan(&data.UserID, &data.Login)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		code, err := a.createResetCode(r.Context(), addr, data)
		if err != nil {
			return err
		}
		send := func() {
			if err := a.auth.mail.SendPasswordResetCode(context.Background(), addr, code); err != nil {
				slog.Error("доставка письма для сброса пароля", "err", err)
			}
		}
		if a.auth.mail.Local() {
			send()
		} else {
			// Сетевое время SMTP не должно выдавать существование аккаунта по времени ответа.
			safe.Go("доставка кода сброса пароля", send)
		}
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "Если такая почта зарегистрирована, мы отправили на неё код", "local_delivery": a.auth.mail.Local()})
	return nil
}

func (a *App) createResetCode(ctx context.Context, addr string, data account.CodeData) (string, error) {
	challenge, err := account.NewChallenge(data, time.Now())
	if err != nil {
		return "", err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err := challenge.Save(ctx, tx, "reset:"+addr); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	a.auth.unlockCode("reset:" + addr)
	return challenge.Code, nil
}

func (a *App) resetPassword(w http.ResponseWriter, r *http.Request, _ User) error {
	var req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := decode(w, r, &req); err != nil {
		return err
	}
	addr := strings.ToLower(strings.TrimSpace(req.Email))
	if !account.ValidEmail(addr) || strings.TrimSpace(req.Code) == "" {
		return reject(400, "Укажите email и код")
	}
	if msg := account.PasswordLengthError(req.NewPassword); msg != "" {
		return reject(400, msg)
	}
	var login string
	err := a.withMailCode(w, r, "reset:"+addr, req.Code, func(tx *sql.Tx, data account.CodeData) error {
		hash, err := account.HashPassword(req.NewPassword)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(r.Context(), "UPDATE users SET password_hash=? WHERE id=? AND email=?", string(hash), data.UserID, addr)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return reject(400, "Аккаунт не найден. Запросите код заново")
		}
		login = strings.ToLower(data.Login)
		_, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id=?", data.UserID)
		return err
	})
	if err != nil {
		return err
	}
	a.auth.attempts.RecordSuccess(loginPair(login, r))
	a.auth.attempts.RecordSuccess(loginPair(addr, r))
	writeJSON(w, 200, map[string]any{"success": true, "message": "Пароль изменён. Войдите с новым паролем"})
	return nil
}
