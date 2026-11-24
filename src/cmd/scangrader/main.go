package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"scangrader/src/api"
	"scangrader/src/grading"
	"scangrader/src/storage"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(args []string) error {
	if len(args) != 0 && (len(args) != 2 || args[0] != "token" || (args[1] != grading.Teacher && args[1] != grading.Student)) {
		return fmt.Errorf("использование: scangrader [token teacher|student]")
	}
	dir := os.Getenv("SG_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	store, err := storage.Open(dir)
	if err != nil {
		return err
	}
	defer store.Close()
	if len(args) == 2 {
		token, err := store.DemoToken(context.Background(), args[1])
		if err != nil {
			return err
		}
		fmt.Println(token)
		return nil
	}
	addr := os.Getenv("SG_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	server := http.Server{
		Addr:              addr,
		Handler:           api.New(store),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	log.Printf("Scan Grader слушает %s", addr)
	return server.ListenAndServe()
}
