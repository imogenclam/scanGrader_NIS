package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"scangrader/internal/pdf"
	"scangrader/internal/server"
	"scangrader/web"
)

func setting(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func run() error {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return errors.New("не удалось прочитать .env, проверьте формат переменных")
	}
	seed := flag.Bool("init-teacher", false, "создать аккаунт teacher, если его ещё нет")
	data := flag.String("data", setting("SG_DATA_DIR", "data"), "каталог базы и файлов")
	addr := flag.String("addr", setting("SG_ADDR", "127.0.0.1:8080"), "адрес HTTP-сервера")
	flag.Parse()
	app, err := server.Open(*data, os.Getenv("SG_SECURE_COOKIE") == "1")
	if err != nil {
		return err
	}
	defer app.Close()
	if *seed {
		password, err := app.SeedTeacher()
		if err != nil {
			return err
		}
		if password == "" {
			fmt.Println("Аккаунт teacher уже существует.")
		} else {
			fmt.Printf("Логин: teacher\nПароль: %s\nСохраните пароль. Он показывается один раз.\n", password)
		}
		return nil
	}
	if err = app.Start(); err != nil {
		return err
	}
	srv := &http.Server{Addr: *addr, Handler: app.Routes(web.Handler()), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 3 * time.Minute, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	failure := make(chan error, 1)
	go func() { failure <- srv.ListenAndServe() }()
	log.Printf("Scan Grader: http://%s", *addr)
	select {
	case err := <-failure:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
	return nil
}
func main() {
	pdf.ServePDFHelper()
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
