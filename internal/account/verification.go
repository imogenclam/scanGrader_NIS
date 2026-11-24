package account

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

const (
	CodeTTL         = 15 * time.Minute
	ResendInterval  = time.Minute
	maxCodeAttempts = 5
)

var (
	ErrCodeMissing = errors.New("Код не запрашивался или уже был использован")
	ErrCodeExpired = errors.New("Код истёк, запросите новый")
	ErrCodeWrong   = errors.New("Неверный код")
)

// Неподтверждённая анкета хранит только хэш пароля. Поле UserID используется при сбросе.
type CodeData struct {
	Login        string `json:"login,omitempty"`
	LoginKey     string `json:"login_key,omitempty"`
	PasswordHash string `json:"password_hash,omitempty"`
	FullName     string `json:"full_name,omitempty"`
	GroupNumber  string `json:"group_number,omitempty"`
	TeacherNote  string `json:"teacher_note,omitempty"`
	UserID       int    `json:"user_id,omitempty"`
}

type Challenge struct {
	Code      string
	Data      CodeData
	ExpiresAt int64
	SentAt    int64
}

func NewVerificationCode() (string, error) {
	n, err := cryptorand.Int(cryptorand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

type queryOne interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func LoadCode(ctx context.Context, db queryOne, key string) (Challenge, error) {
	var c Challenge
	var data []byte
	err := db.QueryRowContext(ctx,
		"SELECT code,data_json,expires_at,sent_at FROM email_verifications WHERE email=?", key).
		Scan(&c.Code, &data, &c.ExpiresAt, &c.SentAt)
	if err == nil {
		err = json.Unmarshal(data, &c.Data)
	}
	return c, err
}

func NewChallenge(data CodeData, now time.Time) (Challenge, error) {
	code, err := NewVerificationCode()
	return Challenge{Code: code, Data: data, SentAt: now.Unix(), ExpiresAt: now.Add(CodeTTL).Unix()}, err
}

func (c Challenge) Save(ctx context.Context, tx *sql.Tx, key string) error {
	data, err := json.Marshal(c.Data)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM email_verifications WHERE expires_at<=?", time.Now().Unix()); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO email_verifications(email,code,data_json,expires_at,sent_at)
		VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code=excluded.code,data_json=excluded.data_json,
		expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`, key, c.Code, string(data), c.ExpiresAt, c.SentAt)
	return err
}

// WithVerifiedCode выполняет действие и одноразовое погашение одной транзакцией.
// Неверные попытки также сохраняются в БД, в том числе при параллельных запросах и перезапуске.
func WithVerifiedCode(ctx context.Context, db *sql.DB, key, submitted string, apply func(*sql.Tx, CodeData) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	c, err := LoadCode(ctx, tx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCodeMissing
	}
	if err != nil {
		return err
	}
	var result error
	switch {
	case time.Now().Unix() >= c.ExpiresAt:
		result = ErrCodeExpired
	case subtle.ConstantTimeCompare([]byte(c.Code), []byte(strings.TrimSpace(submitted))) != 1:
		result = ErrCodeWrong
		if _, err := tx.ExecContext(ctx, "UPDATE email_verifications SET attempts=attempts+1 WHERE email=?", key); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM email_verifications WHERE email=? AND attempts>=?", key, maxCodeAttempts); err != nil {
			return err
		}
	default:
		if err := apply(tx, c.Data); err != nil {
			return err
		}
	}
	if !errors.Is(result, ErrCodeWrong) {
		if _, err := tx.ExecContext(ctx, "DELETE FROM email_verifications WHERE email=?", key); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return result
}
