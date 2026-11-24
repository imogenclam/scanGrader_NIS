package server

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"scangrader/internal/grading"
)

func setupQueue(t *testing.T) (*App, *int) {
	t.Helper()
	t.Setenv("SG_SMTP_HOST", "")
	t.Setenv("SG_OCR_KEY", "")
	a, err := Open(t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Close)
	ref := []byte("2+2=4")
	version := fmt.Sprintf("%x", sha256.Sum256(ref))
	if err := os.WriteFile(filepath.Join(a.files, "ref.tex"), ref, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a.files, "work.pdf"), syntheticPDF(t, 1), 0600); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`INSERT INTO users(id,login,login_key,password_hash,role,full_name) VALUES
		  (1,'t','t','','teacher','T'), (2,'s','s','','student','S'), (3,'s2','s2','','student','S2')`,
		`INSERT INTO subjects(id,title,invite_code,created_by) VALUES (1,'Math','ABC123',1)`,
	} {
		if _, err := a.db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.db.Exec(`INSERT INTO assignments(id,subject_id,title,statement,tasks,reference_file,reference_version)
		VALUES (1,1,'Math','2+2','[{"number":1,"max":1}]','ref.tex',?)`, version); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec(`INSERT INTO submissions(id,assignment_id,student_id,pdf_file,reference_version)
		VALUES (1,1,2,'work.pdf',?)`, version); err != nil {
		t.Fatal(err)
	}
	calls := 0
	a.review = func(context.Context, string, string, string, string, []grading.Task) ([]grading.Grade, error) {
		calls++
		score := 0.7
		return []grading.Grade{{Number: 1, Score: &score, Comment: fmt.Sprintf("Попытка %d", calls)}}, nil
	}
	return a, &calls
}

func TestQueueRetriesCompletedDraftWithoutRepeatingGrading(t *testing.T) {
	a, calls := setupQueue(t)
	_, err := a.db.Exec(`CREATE TRIGGER fail_draft BEFORE UPDATE OF draft ON submissions
		WHEN NEW.id=1 AND NEW.state='draft' BEGIN SELECT RAISE(FAIL,'temporary write error'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.next(context.Background()); err == nil {
		t.Fatal("ожидался отказ записи черновика")
	}
	if _, err = a.db.Exec(`CREATE TRIGGER unavailable_manual BEFORE UPDATE OF state ON submissions
		WHEN NEW.state='manual' BEGIN SELECT RAISE(FAIL,'temporary write error'); END`); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		_, _ = a.next(context.Background())
	}
	if _, err = a.db.Exec("DROP TRIGGER fail_draft"); err != nil {
		t.Fatal(err)
	}
	if _, err = a.next(context.Background()); err != nil {
		t.Fatal(err)
	}
	var state, saved string
	if err = a.db.QueryRow("SELECT state,coalesce(draft,'') FROM submissions WHERE id=1").Scan(&state, &saved); err != nil {
		t.Fatal(err)
	}
	if state != "draft" || saved != `[{"number":1,"score":0.7,"comment":"Попытка 1"}]` || *calls != 1 {
		t.Fatalf("состояние %s, черновик %q, вызовов модели %d", state, saved, *calls)
	}
}

func TestQueueRecoversAbandonedReviewAndProcessesFollowingSubmission(t *testing.T) {
	a, calls := setupQueue(t)
	_, err := a.db.Exec(`CREATE TRIGGER fail_result BEFORE UPDATE OF state ON submissions
		WHEN NEW.id=1 AND NEW.state='draft' BEGIN SELECT RAISE(FAIL,'draft rejected'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.next(context.Background()); err == nil {
		t.Fatal("ожидался отказ записи результата")
	}
	if _, err := a.db.Exec(`INSERT INTO submissions(id,assignment_id,student_id,pdf_file,reference_version)
		SELECT 2,1,3,pdf_file,reference_version FROM submissions WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		_, _ = a.next(context.Background())
	}
	var state string
	if err = a.db.QueryRow("SELECT state FROM submissions WHERE id=2").Scan(&state); err != nil || state != "draft" {
		t.Fatalf("следующая работа задержалась, статус %s, ошибка %v", state, err)
	}
	if _, err = a.next(context.Background()); err != nil {
		t.Fatal(err)
	}
	var reason string
	if err = a.db.QueryRow("SELECT state,reason FROM submissions WHERE id=1").Scan(&state, &reason); err != nil {
		t.Fatal(err)
	}
	if state != "manual" || reason == "" || *calls != 2 {
		t.Fatalf("состояние %s, причина %q, вызовов %d", state, reason, *calls)
	}
}
