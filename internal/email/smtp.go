package email

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/smtp"
	"time"
)

var sendSlots = make(chan struct{}, 4)

// Ограничение соединений и таймауты перенесены из VisualMath. На 465 TLS начинается до SMTP.
func sendMail(ctx context.Context, addr, user, password, from, to string, msg []byte) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	select {
	case sendSlots <- struct{}{}:
		defer func() { <-sendSlots }()
	case <-ctx.Done():
		return ctx.Err()
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return err
	}
	secure := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	if port == "465" {
		conn = tls.Client(conn, secure)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("SMTP-сервер не поддерживает STARTTLS")
		}
		if err := client.StartTLS(secure); err != nil {
			return err
		}
	}
	if user != "" {
		if err := client.Auth(smtp.PlainAuth("", user, password, host)); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	body, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := body.Write(msg); err != nil {
		return err
	}
	if err := body.Close(); err != nil {
		return err
	}
	return client.Quit()
}
