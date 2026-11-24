package storage

import (
	"context"
	"database/sql"
	"time"
)

const QueryTimeout = 15 * time.Second

func Ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), QueryTimeout)
}

func CtxFrom(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, QueryTimeout)
}

// Healthy — база отвечает на запрос, а не только держит соединение.
func Healthy(ctx context.Context, db *sql.DB) error {
	var one int
	return db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}
