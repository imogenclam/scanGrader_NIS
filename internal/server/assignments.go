package server

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"scangrader/internal/grading"
)

type assignment struct {
	ID           int            `json:"id"`
	SubjectID    int            `json:"subject_id"`
	SubjectTitle string         `json:"subject_title"`
	Title        string         `json:"title"`
	Statement    string         `json:"statement"`
	Tasks        []grading.Task `json:"tasks"`
	RefFile      string         `json:"-"`
	Version      string         `json:"-"`
}

func (a *App) loadAssignment(id int) (assignment, error) {
	var d assignment
	var raw string
	err := a.db.QueryRow(`SELECT a.id,a.subject_id,s.title,a.title,a.statement,a.tasks,a.reference_file,a.reference_version
		FROM assignments a JOIN subjects s ON s.id=a.subject_id WHERE a.id=?`, id).
		Scan(&d.ID, &d.SubjectID, &d.SubjectTitle, &d.Title, &d.Statement, &raw, &d.RefFile, &d.Version)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &d.Tasks)
	}
	return d, err
}
func (a *App) permittedAssignment(r *http.Request, u User) (assignment, error) {
	id, err := itemID(r)
	if err != nil {
		return assignment{}, err
	}
	d, err := a.loadAssignment(id)
	if err != nil {
		return d, err
	}
	return d, a.subjectAccess(d.SubjectID, u)
}
func form(w http.ResponseWriter, r *http.Request, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(128<<10))
	if err := r.ParseMultipartForm(512 << 10); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return reject(413, "Файл превышает допустимый размер")
		}
		return reject(400, "Не удалось прочитать форму с файлом")
	}
	return nil
}
func oneFile(r *http.Request, key, extension string, maxBytes int64) (*multipart.FileHeader, error) {
	parts := r.MultipartForm.File[key]
	if len(parts) != 1 || len(r.MultipartForm.File) != 1 {
		return nil, reject(400, "Прикрепите один файл "+extension)
	}
	f := parts[0]
	if !strings.EqualFold(filepath.Ext(f.Filename), extension) || f.Size == 0 {
		return nil, reject(400, "Нужен непустой файл "+extension)
	}
	if f.Size > maxBytes {
		return nil, reject(413, "Файл превышает допустимый размер")
	}
	return f, nil
}
func (a *App) saveFile(src io.Reader, pattern string) (string, error) {
	f, err := os.CreateTemp(a.files, pattern)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(f, src)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return filepath.Base(f.Name()), nil
}
func (a *App) publish(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := itemID(r)
	if err != nil {
		return err
	}
	if u.Role != "teacher" {
		return reject(403, "Задание публикует преподаватель")
	}
	if err = a.subjectAccess(id, u); err != nil {
		return err
	}
	const refLimit = 256 << 10
	if err = form(w, r, refLimit); err != nil {
		return err
	}
	defer r.MultipartForm.RemoveAll()
	title, statement := strings.TrimSpace(r.FormValue("title")), strings.TrimSpace(r.FormValue("statement"))
	if title == "" || utf8.RuneCountInString(title) > 160 || statement == "" || utf8.RuneCountInString(statement) > 16000 {
		return reject(400, "Укажите название до 160 знаков и условия до 16000 знаков")
	}
	var tasks []grading.Task
	if err = json.Unmarshal([]byte(r.FormValue("tasks")), &tasks); err != nil {
		return reject(400, "Проверьте номера задач и максимумы")
	}
	if err = grading.ValidateTasks(tasks); err != nil {
		return reject(400, err.Error())
	}
	part, err := oneFile(r, "reference", ".tex", refLimit)
	if err != nil {
		return err
	}
	f, err := part.Open()
	if err != nil {
		return err
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	reference := string(raw)
	if !utf8.Valid(raw) || strings.TrimSpace(reference) == "" || strings.ContainsRune(reference, 0) {
		return reject(400, "Сохраните эталон .tex как текст в UTF-8")
	}
	key, err := a.saveFile(strings.NewReader(reference), "reference-*.tex")
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(tasks)
	if err != nil {
		os.Remove(filepath.Join(a.files, key))
		return err
	}
	version := fmt.Sprintf("%x", sha256.Sum256(raw))
	var assignmentID int
	err = a.db.QueryRowContext(r.Context(), `INSERT INTO assignments(subject_id,title,statement,tasks,reference_file,reference_version) VALUES (?,?,?,?,?,?) RETURNING id`, id, title, statement, string(encoded), key, version).Scan(&assignmentID)
	if err != nil {
		os.Remove(filepath.Join(a.files, key))
		return err
	}
	writeJSON(w, 201, map[string]any{"id": assignmentID, "reference_version": version})
	return nil
}
func (a *App) reference(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "teacher" {
		return reject(403, "Эталон доступен преподавателю предмета")
	}
	d, err := a.permittedAssignment(r, u)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Disposition", `attachment; filename="solutions.tex"`)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	http.ServeFile(w, r, filepath.Join(a.files, d.RefFile))
	return nil
}
func (a *App) assignment(w http.ResponseWriter, r *http.Request, u User) error {
	d, err := a.permittedAssignment(r, u)
	if err != nil {
		return err
	}
	q := `SELECT s.id,u.full_name,u.group_number,s.state,s.submitted_at FROM submissions s JOIN users u ON u.id=s.student_id WHERE s.assignment_id=?`
	args := []any{d.ID}
	if u.Role != "teacher" {
		q += " AND s.student_id=?"
		args = append(args, u.ID)
	}
	rows, err := a.db.QueryContext(r.Context(), q+" ORDER BY s.id DESC", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []submissionInfo{}
	for rows.Next() {
		var s submissionInfo
		if err = rows.Scan(&s.ID, &s.Student, &s.Group, &s.State, &s.SubmittedAt); err != nil {
			return err
		}
		s.State = visibleState(s.State, u.Role)
		list = append(list, s)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"assignment": d, "submissions": list})
	return nil
}
