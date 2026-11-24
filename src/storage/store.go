package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
	"scangrader/src/grading"
)

//go:embed migrations/001_init.sql
var initialSchema string

type Store struct{ db *sql.DB }

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path, err := filepath.Abs(filepath.Join(dir, "scangrader.db"))
	if err != nil {
		return nil, err
	}
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	u := url.URL{Scheme: "file", Path: path, RawQuery: "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_txlock=immediate"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	switch version {
	case 0:
		_, err = tx.Exec(initialSchema, sql.Named("teacherToken", rand.Text()), sql.Named("studentToken", rand.Text()))
		if err != nil {
			return err
		}
	case 1:
	default:
		return fmt.Errorf("неизвестная версия схемы %d", version)
	}
	return tx.Commit()
}

func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) DemoToken(ctx context.Context, role string) (string, error) {
	var token string
	err := s.db.QueryRowContext(ctx, "SELECT token FROM demo_actors WHERE id = ? AND role = ?", role+"-demo", role).Scan(&token)
	return token, err
}

func (s *Store) Authenticate(ctx context.Context, token string) (grading.Actor, error) {
	var actor grading.Actor
	err := s.db.QueryRowContext(ctx, "SELECT id, role FROM demo_actors WHERE token = ?", token).Scan(&actor.ID, &actor.Role)
	if errors.Is(err, sql.ErrNoRows) {
		err = grading.ErrUnauthorized
	}
	return actor, err
}
