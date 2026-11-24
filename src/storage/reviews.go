package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"scangrader/src/grading"
)

type reader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// Одна выборка читает статус и все строки в одном снимке SQLite.
func readSubmission(ctx context.Context, db reader, id int64, actor grading.Actor) (grading.Submission, error) {
	var result grading.Submission
	rows, err := db.QueryContext(ctx, `
		SELECT s.id, coalesce(s.approved_by, ''), coalesce(s.approved_at, ''),
		       t.number, t.max_score, t.draft_score, t.draft_comment, f.score, coalesce(f.comment, '')
		  FROM submissions s JOIN submission_tasks t ON t.submission_id = s.id
		  LEFT JOIN final_grades f ON f.submission_id = t.submission_id AND f.number = t.number
		 WHERE s.id = ? AND ((? = 'teacher' AND s.teacher_id = ?) OR (? = 'student' AND s.student_id = ?))
		 ORDER BY t.number`, id, actor.Role, actor.ID, actor.Role, actor.ID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	var total float64
	for rows.Next() {
		var task grading.Task
		var draft, final grading.Grade
		err := rows.Scan(&result.ID, &result.ApprovedBy, &result.ApprovedAt, &task.Number, &task.Max,
			&draft.Score, &draft.Comment, &final.Score, &final.Comment)
		if err != nil {
			return result, err
		}
		result.Tasks = append(result.Tasks, task)
		draft.Number = task.Number
		result.Draft = append(result.Draft, draft)
		if result.ApprovedAt != "" && final.Score != nil {
			final.Number = task.Number
			result.Grades = append(result.Grades, final)
			total += *final.Score
		}
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if result.ID == 0 {
		return result, grading.ErrNotFound
	}
	result.Status = grading.PendingReview
	if result.ApprovedAt != "" {
		result.Status = grading.Approved
		result.Total = &total
	}
	if actor.Role == grading.Student {
		return result.Published(), nil
	}
	return result, nil
}

func (s *Store) Submission(ctx context.Context, id int64, actor grading.Actor) (grading.Submission, error) {
	return readSubmission(ctx, s.db, id, actor)
}

func (s *Store) Approve(ctx context.Context, id int64, actor grading.Actor, grades []grading.Grade) (grading.Submission, error) {
	var empty grading.Submission
	if actor.Role != grading.Teacher {
		return empty, grading.ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback()
	review, err := readSubmission(ctx, tx, id, actor)
	if err != nil {
		return empty, err
	}
	if err := grading.Validate(review.Tasks, grades); err != nil {
		return empty, fmt.Errorf("%w: %v", grading.ErrInvalid, err)
	}
	if review.Status == grading.Approved {
		return empty, grading.ErrApproved
	}
	for _, row := range grades {
		_, err = tx.ExecContext(ctx, "INSERT INTO final_grades (submission_id, number, score, comment) VALUES (?, ?, ?, ?)",
			id, row.Number, *row.Score, row.Comment)
		if err != nil {
			return empty, err
		}
	}
	_, err = tx.ExecContext(ctx, "UPDATE submissions SET approved_at = ?, approved_by = ? WHERE id = ?",
		time.Now().UTC().Format(time.RFC3339), actor.ID, id)
	if err != nil {
		return empty, err
	}
	review, err = readSubmission(ctx, tx, id, actor)
	if err != nil {
		return empty, err
	}
	if err := tx.Commit(); err != nil {
		return empty, err
	}
	return review.Published(), nil
}
