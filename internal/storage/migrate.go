package storage

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
)

//go:embed migrations/001_classroom.sql
var initialSchema string

//go:embed migrations/002_accounts.sql
var accountSchema string

func MigrateUp(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	switch version {
	case 0:
		if _, err := tx.ExecContext(ctx, initialSchema); err != nil {
			return err
		}
		fallthrough
	case 1:
		if _, err := tx.ExecContext(ctx, accountSchema); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version=2"); err != nil {
			return err
		}
	case 2:
	default:
		return fmt.Errorf("неподдерживаемая версия базы %d", version)
	}
	return tx.Commit()
}
