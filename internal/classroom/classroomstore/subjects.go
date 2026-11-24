package classroomstore

import (
	"scangrader/internal/storage"
)

func (r *ClassroomRepo) CreateSubject(title, description, inviteCode string, teacherID int) (int, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(
		`INSERT INTO subjects (title, description, invite_code, created_by) VALUES (?,?,?,?)`,
		title, description, inviteCode, teacherID,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`INSERT INTO subject_teachers (subject_id, teacher_id) VALUES (?,?)`, id, teacherID); err != nil {
		return 0, err
	}
	return int(id), tx.Commit()
}

func (r *ClassroomRepo) GetSubjectsForTeacher(teacherID int) ([]SubjectWithRole, error) {
	ctx, cancel := storage.Ctx()
	defer cancel()
	rows, err := r.DB.QueryContext(ctx, `
		SELECT s.id, s.title, COALESCE(s.description,''), s.invite_code, s.created_by, s.created_at, s.archived,
		       (s.created_by = ?) as is_owner,
		       (SELECT COUNT(*) FROM subject_teachers WHERE subject_id = s.id) as teacher_count,
		       (SELECT COUNT(*) FROM subject_students WHERE subject_id = s.id) as student_count,
		       (SELECT COUNT(*) FROM assignments WHERE subject_id = s.id) as assign_count,
		       COALESCE((SELECT title FROM assignments WHERE subject_id = s.id ORDER BY id DESC LIMIT 1),'')
		FROM subjects s
		JOIN subject_teachers st ON st.subject_id = s.id
		WHERE st.teacher_id = ?
		ORDER BY s.created_at DESC
	`, teacherID, teacherID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []SubjectWithRole
	for rows.Next() {
		var sw SubjectWithRole
		err := rows.Scan(&sw.ID, &sw.Title, &sw.Description, &sw.InviteCode,
			&sw.CreatedBy, &sw.CreatedAt, &sw.Archived, &sw.IsOwner,
			&sw.TeacherCount, &sw.StudentCount, &sw.AssignCount, &sw.LatestTitle)
		if err != nil {
			return nil, err
		}
		result = append(result, sw)
	}
	return result, rows.Err()
}

func (r *ClassroomRepo) GetSubjectsForStudent(studentID int) ([]SubjectWithRole, error) {
	ctx, cancel := storage.Ctx()
	defer cancel()
	rows, err := r.DB.QueryContext(ctx, `
		SELECT s.id, s.title, COALESCE(s.description,''), s.invite_code, s.created_by, s.created_at, s.archived,
		       0 as is_owner,
		       (SELECT COUNT(*) FROM subject_teachers WHERE subject_id = s.id) as teacher_count,
		       (SELECT COUNT(*) FROM subject_students WHERE subject_id = s.id) as student_count,
		       (SELECT COUNT(*) FROM assignments WHERE subject_id = s.id) as assign_count,
		       COALESCE((SELECT title FROM assignments WHERE subject_id = s.id ORDER BY id DESC LIMIT 1),'')
		FROM subjects s
		JOIN subject_students ss ON ss.subject_id = s.id
		WHERE ss.student_id = ?
		ORDER BY s.created_at DESC
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []SubjectWithRole
	for rows.Next() {
		var sw SubjectWithRole
		err := rows.Scan(&sw.ID, &sw.Title, &sw.Description, &sw.InviteCode,
			&sw.CreatedBy, &sw.CreatedAt, &sw.Archived, &sw.IsOwner,
			&sw.TeacherCount, &sw.StudentCount, &sw.AssignCount, &sw.LatestTitle)
		if err != nil {
			return nil, err
		}
		result = append(result, sw)
	}
	return result, rows.Err()
}

func (r *ClassroomRepo) GetSubjectByID(id int) (*Subject, error) {
	s := &Subject{}
	err := r.DB.QueryRow(`SELECT id, title, COALESCE(description,''), invite_code, created_by, created_at, archived FROM subjects WHERE id = ?`, id).
		Scan(&s.ID, &s.Title, &s.Description, &s.InviteCode, &s.CreatedBy, &s.CreatedAt, &s.Archived)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *ClassroomRepo) GetSubjectByInviteCode(code string) (*Subject, error) {
	s := &Subject{}
	err := r.DB.QueryRow(`SELECT id, title, COALESCE(description,''), invite_code, created_by, created_at, archived FROM subjects WHERE invite_code = ?`, code).
		Scan(&s.ID, &s.Title, &s.Description, &s.InviteCode, &s.CreatedBy, &s.CreatedAt, &s.Archived)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *ClassroomRepo) IsTeacherOfSubject(subjectID, teacherID int) (bool, error) {
	var count int
	err := r.DB.QueryRow(`SELECT COUNT(*) FROM subject_teachers WHERE subject_id=? AND teacher_id=?`, subjectID, teacherID).Scan(&count)
	return count > 0, err
}

func (r *ClassroomRepo) IsStudentOfSubject(subjectID, studentID int) (bool, error) {
	var count int
	err := r.DB.QueryRow(`SELECT COUNT(*) FROM subject_students WHERE subject_id=? AND student_id=?`, subjectID, studentID).Scan(&count)
	return count > 0, err
}

func (r *ClassroomRepo) JoinSubject(subjectID, studentID int) error {
	_, err := r.DB.Exec(`INSERT OR IGNORE INTO subject_students (subject_id, student_id) VALUES (?,?)`, subjectID, studentID)
	return err
}
