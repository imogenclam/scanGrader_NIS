package storage

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	_ "modernc.org/sqlite"
)

// _txlock=immediate не убирать
func sqliteDSN(dbPath string) string {
	return dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=synchronous(NORMAL)&_pragma=cache_size(10000)&_pragma=temp_store(MEMORY)&_pragma=foreign_keys(ON)&_txlock=immediate"
}

// Open открывает файл базы с настройками сервера и доводит схему до текущей.
func Open(dbPath string) (*sql.DB, error) {
	db, err := OpenNoMigrate(dbPath)
	if err != nil {
		return nil, err
	}
	if err := MigrateUp(context.Background(), db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// OpenNoMigrate — то же без миграций, для make migrate-status.
func OpenNoMigrate(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", sqliteDSN(dbPath))
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("не удалось подключиться к БД: %w", err)
	}

	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(time.Hour)
	db.SetConnMaxIdleTime(2 * time.Minute)

	var journalMode, foreignKeys string
	db.QueryRow("PRAGMA journal_mode").Scan(&journalMode)
	db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys)
	slog.Info("SQLite", "journal_mode", journalMode, "foreign_keys", foreignKeys)
	return db, nil
}
