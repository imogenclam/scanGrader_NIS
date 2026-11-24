// Package email доставляет коды Scan Grader по SMTP или в закрытую локальную папку.
package email

import (
	"context"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Sender struct {
	dir      string
	host     string
	port     string
	from     string
	user     string
	password string
}

func FromEnv(dataDir string) (Sender, error) {
	s := Sender{
		dir:  filepath.Join(dataDir, "mail"),
		host: strings.TrimSpace(os.Getenv("SG_SMTP_HOST")), port: strings.TrimSpace(os.Getenv("SG_SMTP_PORT")),
		from: strings.TrimSpace(os.Getenv("SG_SMTP_FROM")), user: os.Getenv("SG_SMTP_USER"), password: os.Getenv("SG_SMTP_PASSWORD"),
	}
	if s.Local() {
		s.from = "scangrader@localhost"
		if err := os.MkdirAll(s.dir, 0700); err != nil {
			return Sender{}, err
		}
		if err := restrictDirectory(s.dir); err != nil {
			return Sender{}, fmt.Errorf("защита локальной папки писем: %w", err)
		}
		return s, nil
	}
	if s.port == "" {
		s.port = "587"
	}
	n, err := strconv.Atoi(s.port)
	if err != nil || n < 1 || n > 65535 {
		return Sender{}, fmt.Errorf("проверьте SG_SMTP_PORT")
	}
	if s.from == "" {
		s.from = s.user
	}
	from, err := mail.ParseAddress(s.from)
	if err != nil || from.Address != s.from || strings.ContainsAny(s.from, "\r\n") {
		return Sender{}, fmt.Errorf("укажите адрес отправителя в SG_SMTP_FROM")
	}
	if (s.user == "") != (s.password == "") {
		return Sender{}, fmt.Errorf("для SMTP AUTH укажите SG_SMTP_USER и SG_SMTP_PASSWORD")
	}
	return s, nil
}

func (s Sender) Local() bool { return s.host == "" }

func (s Sender) SendVerificationCode(ctx context.Context, to, code string) error {
	return s.send(ctx, to, "Код подтверждения Scan Grader", "Введите код на странице регистрации.", code)
}

func (s Sender) SendPasswordResetCode(ctx context.Context, to, code string) error {
	return s.send(ctx, to, "Сброс пароля Scan Grader", "Введите код на странице восстановления пароля.", code)
}

func (s Sender) send(ctx context.Context, to, subject, instruction, code string) error {
	dest, err := mail.ParseAddress(to)
	if err != nil || dest.Address != to || strings.ContainsAny(to, "\r\n") {
		return fmt.Errorf("некорректный адрес получателя")
	}
	msg := []byte("From: Scan Grader <" + s.from + ">\r\nTo: " + to +
		"\r\nSubject: " + mime.BEncoding.Encode("UTF-8", subject) + "\r\nDate: " + time.Now().Format(time.RFC1123Z) +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" +
		instruction + " Код действует 15 минут.\r\n\r\nКод: " + code + "\r\n")
	if s.Local() {
		return s.store(msg)
	}
	return sendMail(ctx, net.JoinHostPort(s.host, s.port), s.user, s.password, s.from, to, msg)
}

func (s Sender) store(message []byte) error {
	f, err := os.CreateTemp(s.dir, time.Now().UTC().Format("20060102T150405.000000000Z")+"-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(message)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), strings.TrimSuffix(f.Name(), ".tmp")+".eml")
}
