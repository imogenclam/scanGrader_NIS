package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"scangrader/internal/classroom/classroomstore"
	"scangrader/internal/platform/codes"
)

func (a *App) subjectAccess(id int, u User) error {
	var ok bool
	var err error
	if u.Role == "teacher" {
		ok, err = a.classroom.IsTeacherOfSubject(id, u.ID)
	} else {
		ok, err = a.classroom.IsStudentOfSubject(id, u.ID)
	}
	if err != nil {
		return err
	}
	if !ok {
		return reject(403, "Нет доступа к предмету")
	}
	return nil
}
func (a *App) subjects(w http.ResponseWriter, r *http.Request, u User) error {
	var list []classroomstore.SubjectWithRole
	var err error
	if u.Role == "teacher" {
		list, err = a.classroom.GetSubjectsForTeacher(u.ID)
	} else {
		list, err = a.classroom.GetSubjectsForStudent(u.ID)
		for i := range list {
			list[i].InviteCode = ""
		}
	}
	if err != nil {
		return err
	}
	if list == nil {
		list = []classroomstore.SubjectWithRole{}
	}
	writeJSON(w, 200, list)
	return nil
}
func (a *App) createSubject(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "teacher" {
		return reject(403, "Предмет создаёт преподаватель")
	}
	var b struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := decode(w, r, &b); err != nil {
		return err
	}
	title := strings.TrimSpace(b.Title)
	description := strings.TrimSpace(b.Description)
	if utf8.RuneCountInString(description) > 2000 {
		return reject(400, "Сократите описание предмета до 2000 знаков")
	}
	if title == "" || utf8.RuneCountInString(title) > 150 {
		return reject(400, "Укажите название предмета до 150 знаков")
	}
	for range codes.Tries {
		code := codes.New(codes.Short)
		id, err := a.classroom.CreateSubject(title, description, code, u.ID)
		if err == nil {
			writeJSON(w, 201, map[string]any{"id": id, "invite_code": code})
			return nil
		}
		if !strings.Contains(err.Error(), "UNIQUE constraint failed: subjects.invite_code") {
			return err
		}
	}
	return codes.ErrNoFreeCode
}
func (a *App) join(w http.ResponseWriter, r *http.Request, u User) error {
	if u.Role != "student" {
		return reject(403, "Вступление по коду доступно студентам")
	}
	if err := a.throttle(r, "join"); err != nil {
		return err
	}
	if u.FullName == "" || u.Group == "" {
		return reject(400, "Заполните ФИО и группу в личном кабинете")
	}
	var b struct {
		Code string `json:"code"`
	}
	if err := decode(w, r, &b); err != nil {
		return err
	}
	sub, err := a.classroom.GetSubjectByInviteCode(strings.ToUpper(strings.TrimSpace(b.Code)))
	if errors.Is(err, sql.ErrNoRows) {
		return reject(404, "Предмет с таким кодом не найден")
	}
	if err != nil {
		return err
	}
	if err = a.classroom.JoinSubject(sub.ID, u.ID); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int{"id": sub.ID})
	return nil
}

type listed struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
}

func (a *App) subject(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := itemID(r)
	if err != nil {
		return err
	}
	if err = a.subjectAccess(id, u); err != nil {
		return err
	}
	s, err := a.classroom.GetSubjectByID(id)
	if err != nil {
		return err
	}
	if u.Role != "teacher" {
		s.InviteCode = ""
	}
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,title FROM assignments WHERE subject_id=? ORDER BY id DESC", id)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []listed{}
	for rows.Next() {
		var v listed
		if err = rows.Scan(&v.ID, &v.Title); err != nil {
			return err
		}
		list = append(list, v)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"subject": s, "assignments": list})
	return nil
}
