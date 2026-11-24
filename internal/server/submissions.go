package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"scangrader/internal/grading"
	"scangrader/internal/pdf"
)

type submissionInfo struct {
	ID          int    `json:"id"`
	Student     string `json:"student"`
	Group       string `json:"group"`
	State       string `json:"state"`
	SubmittedAt string `json:"submitted_at"`
}
type submissionReceipt struct {
	ID               int  `json:"id"`
	AlreadySubmitted bool `json:"already_submitted"`
}
type submission struct {
	submissionInfo
	AssignmentID int             `json:"assignment_id"`
	StudentID    int             `json:"-"`
	File         string          `json:"-"`
	Reason       string          `json:"reason,omitempty"`
	Draft        json.RawMessage `json:"draft,omitempty"`
	Final        json.RawMessage `json:"final,omitempty"`
	ApprovedBy   string          `json:"approved_by,omitempty"`
	ApprovedAt   string          `json:"approved_at,omitempty"`
	CanRetry     bool            `json:"can_retry,omitempty"`
}

func visibleState(state, role string) string {
	if role == "student" && state != "approved" {
		return "waiting"
	}
	return state
}
func (a *App) submit(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "student" {
		return reject(403, "Работу сдаёт студент")
	}
	d, err := a.permittedAssignment(r, u)
	if err != nil {
		return err
	}
	var id int
	lookup := func() error {
		return a.db.QueryRowContext(r.Context(), "SELECT id FROM submissions WHERE assignment_id=? AND student_id=?", d.ID, u.ID).Scan(&id)
	}
	if err = lookup(); err == nil {
		writeJSON(w, http.StatusOK, submissionReceipt{ID: id, AlreadySubmitted: true})
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err = setUploadDeadlines(w, r.ContentLength); err != nil {
		return err
	}
	if err = form(w, r, pdf.MaxBytes); err != nil {
		return err
	}
	defer r.MultipartForm.RemoveAll()
	part, err := oneFile(r, "file", ".pdf", pdf.MaxBytes)
	if err != nil {
		return err
	}
	file, err := part.Open()
	if err != nil {
		return err
	}
	defer file.Close()
	name, err := a.saveFile(file, "work-*.pdf")
	if err != nil {
		return err
	}
	path := filepath.Join(a.files, name)
	keep := false
	defer func() {
		if !keep {
			os.Remove(path)
		}
	}()
	if failure := pdf.Check(r.Context(), path); failure != nil {
		return reject(failure.Code, failure.Error())
	}
	err = a.db.QueryRowContext(r.Context(), `INSERT INTO submissions(assignment_id,student_id,pdf_file,reference_version) VALUES (?,?,?,?) ON CONFLICT(assignment_id,student_id) DO NOTHING RETURNING id`, d.ID, u.ID, name, d.Version).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		if err = lookup(); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, submissionReceipt{ID: id, AlreadySubmitted: true})
		return nil
	}
	if err != nil {
		return err
	}
	keep = true
	a.notify()
	writeJSON(w, http.StatusCreated, submissionReceipt{ID: id})
	return nil
}
func (a *App) permittedSubmission(r *http.Request, u User) (submission, assignment, error) {
	var s submission
	var d assignment
	id, err := itemID(r)
	if err != nil {
		return s, d, err
	}
	var draft, final, approvedBy, approvedAt sql.NullString
	var retries int
	err = a.db.QueryRowContext(r.Context(), `SELECT s.assignment_id,s.student_id,s.pdf_file,s.state,s.reason,s.draft,s.final,author.full_name,author.group_number,s.submitted_at,teacher.full_name,s.approved_at,s.retry_count
        FROM submissions s JOIN users author ON author.id=s.student_id LEFT JOIN users teacher ON teacher.id=s.approved_by WHERE s.id=?`, id).Scan(
		&s.AssignmentID, &s.StudentID, &s.File, &s.State, &s.Reason, &draft, &final, &s.Student, &s.Group, &s.SubmittedAt, &approvedBy, &approvedAt, &retries)
	if err != nil {
		return s, d, err
	}
	if u.Role != "teacher" && u.ID != s.StudentID {
		return s, d, reject(403, "Нет доступа к работе")
	}
	d, err = a.loadAssignment(s.AssignmentID)
	if err != nil {
		return s, d, err
	}
	if err = a.subjectAccess(d.SubjectID, u); err != nil {
		return s, d, err
	}
	s.ID = id
	s.CanRetry = u.Role == "teacher" && s.State == "manual" && retries == 0 && a.review != nil
	if u.Role == "teacher" && draft.Valid {
		s.Draft = json.RawMessage(draft.String)
	}
	if u.Role != "teacher" {
		s.Reason = ""
	}
	if s.State == "approved" && final.Valid {
		s.Final = json.RawMessage(final.String)
		s.ApprovedBy = approvedBy.String
		s.ApprovedAt = approvedAt.String
	}
	s.State = visibleState(s.State, u.Role)
	return s, d, nil
}
func (a *App) submission(w http.ResponseWriter, r *http.Request, u User) error {
	s, d, err := a.permittedSubmission(r, u)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"submission": s, "assignment": d})
	return nil
}
func (a *App) original(w http.ResponseWriter, r *http.Request, u User) error {
	s, _, err := a.permittedSubmission(r, u)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `inline; filename="submission.pdf"`)
	http.ServeFile(w, r, filepath.Join(a.files, s.File))
	return nil
}
func (a *App) retryReview(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "teacher" {
		return reject(403, "Повторную проверку запускает преподаватель предмета")
	}
	s, _, err := a.permittedSubmission(r, u)
	if err != nil {
		return err
	}
	if !s.CanRetry {
		return reject(409, "Повторная ИИ-проверка сейчас недоступна")
	}
	result, err := a.db.ExecContext(r.Context(), `UPDATE submissions SET state='queued',reason='',retry_count=1
		WHERE id=? AND state='manual' AND retry_count=0`, s.ID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return reject(409, "Обновите страницу и проверьте текущий статус")
	}
	a.notify()
	writeJSON(w, 200, map[string]string{"state": "queued"})
	return nil
}

func (a *App) approve(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "teacher" {
		return reject(403, "Оценку утверждает преподаватель предмета")
	}
	s, d, err := a.permittedSubmission(r, u)
	if err != nil {
		return err
	}
	var body struct {
		Grades []grading.Grade `json:"grades"`
	}
	if err = decode(w, r, &body); err != nil {
		return err
	}
	if err = grading.Validate(d.Tasks, body.Grades); err != nil {
		return reject(400, err.Error())
	}
	raw, err := json.Marshal(body.Grades)
	if err != nil {
		return err
	}
	res, err := a.db.ExecContext(r.Context(), `UPDATE submissions SET final=?,state='approved',approved_by=?,approved_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND state IN ('manual','draft')`, string(raw), u.ID, s.ID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return reject(409, "Обновите страницу и проверьте текущий статус")
	}
	writeJSON(w, 200, map[string]string{"state": "approved"})
	return nil
}
