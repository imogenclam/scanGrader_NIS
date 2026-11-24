package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestAccountMigrationPreservesVersionOneUsersAndSessions(t *testing.T) {
	db, err := OpenNoMigrate(filepath.Join(t.TempDir(), "previous.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(initialSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version=1;
		INSERT INTO users(id,login,login_key,password_hash,role,full_name,group_number)
		VALUES (3,'Старый','старый','old-hash','student','Старый Ученик','01');
		INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (X'1234',3,424242);`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateUp(context.Background(), db); err != nil {
			t.Fatal(err)
		}
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 2 {
		t.Fatalf("версия после миграции = %d, ошибка %v", version, err)
	}
	var email, name, hash string
	if err := db.QueryRow(`SELECT email,full_name,password_hash FROM users JOIN sessions ON user_id=id WHERE token_hash=X'1234'`).Scan(&email, &name, &hash); err != nil {
		t.Fatal(err)
	}
	if email != "" || name != "Старый Ученик" || hash != "old-hash" {
		t.Fatal("миграция изменила прежний аккаунт")
	}
}
