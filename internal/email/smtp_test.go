package email

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

var testRoots sync.Once

// Принимает одно письмо по STARTTLS с SMTP AUTH целиком на loopback.
func receiveTestMail(conn net.Conn, cert tls.Certificate) (string, error) {
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return "", err
	}
	wire := textproto.NewConn(conn)
	if err := wire.PrintfLine("220 localhost"); err != nil {
		return "", err
	}
	var secured, authenticated bool
	var message string
	for {
		line, err := wire.ReadLine()
		if err != nil {
			return "", err
		}
		response := "250 ok"
		switch {
		case strings.HasPrefix(line, "EHLO "):
			if err := wire.PrintfLine("250-localhost"); err != nil {
				return "", err
			}
			if secured {
				response = "250 AUTH PLAIN"
			} else {
				response = "250 STARTTLS"
			}
		case line == "STARTTLS" && !secured:
			if err := wire.PrintfLine("220 start TLS"); err != nil {
				return "", err
			}
			wire = textproto.NewConn(tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}))
			secured = true
			continue
		case secured && line == "AUTH PLAIN "+base64.StdEncoding.EncodeToString([]byte("\x00test-user\x00test-password")):
			authenticated = true
			response = "235 authenticated"
		case authenticated && line == "MAIL FROM:<sender@example.org>":
		case authenticated && line == "RCPT TO:<recipient@example.org>":
		case authenticated && line == "DATA":
			if err := wire.PrintfLine("354 send data"); err != nil {
				return "", err
			}
			body, err := wire.ReadDotBytes()
			if err != nil {
				return "", err
			}
			message = string(body)
		case line == "QUIT":
			return message, wire.PrintfLine("221 bye")
		default:
			return "", fmt.Errorf("неожиданная SMTP-команда на текущем шаге")
		}
		if err := wire.PrintfLine("%s", response); err != nil {
			return "", err
		}
	}
}

func TestConfiguredSenderDeliversCodeWithTLSAndAuthentication(t *testing.T) {
	// Стандартный сертификат httptest доверен только этому процессу go test.
	fixture := httptest.NewTLSServer(http.NotFoundHandler())
	cert := fixture.TLS.Certificates[0]
	root := fixture.Certificate()
	fixture.Close()
	t.Setenv("GODEBUG", "x509usefallbackroots=1")
	testRoots.Do(func() {
		roots := x509.NewCertPool()
		roots.AddCert(root)
		x509.SetFallbackRoots(roots)
	})
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	type reception struct {
		body string
		err  error
	}
	got := make(chan reception, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			got <- reception{err: err}
			return
		}
		body, err := receiveTestMail(conn, cert)
		got <- reception{body, err}
	}()
	host, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SG_SMTP_HOST", host)
	t.Setenv("SG_SMTP_PORT", port)
	t.Setenv("SG_SMTP_USER", "test-user")
	t.Setenv("SG_SMTP_PASSWORD", "test-password")
	t.Setenv("SG_SMTP_FROM", "sender@example.org")
	sender, err := FromEnv(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if sender.Local() {
		t.Fatal("настроенный SMTP должен доставлять письма напрямую")
	}
	if err := sender.SendVerificationCode(t.Context(), "recipient@example.org", "123456"); err != nil {
		t.Fatal(err)
	}
	result := <-got
	if result.err != nil || !strings.Contains(result.body, "Код: 123456") {
		t.Fatalf("письмо с кодом не доставлено: %v", result.err)
	}
}
