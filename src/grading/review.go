package grading

import "errors"

const (
	Teacher       = "teacher"
	Student       = "student"
	PendingReview = "pending_review"
	Approved      = "approved"
)

var (
	ErrUnauthorized = errors.New("нужен действительный Bearer-токен")
	ErrNotFound     = errors.New("сдача не найдена")
	ErrForbidden    = errors.New("утвердить работу может только преподаватель")
	ErrApproved     = errors.New("работа уже утверждена")
	ErrInvalid      = errors.New("проверьте оценку")
)

type Actor struct {
	ID   string
	Role string
}

type Submission struct {
	ID         int64    `json:"id"`
	Status     string   `json:"status"`
	Tasks      []Task   `json:"tasks,omitempty"`
	Draft      []Grade  `json:"draft,omitempty"`
	Grades     []Grade  `json:"grades,omitempty"`
	Total      *float64 `json:"total,omitempty"`
	ApprovedBy string   `json:"approved_by,omitempty"`
	ApprovedAt string   `json:"approved_at,omitempty"`
}

// Published отдаёт студенту только статус и утверждённый результат.
func (s Submission) Published() Submission {
	s.Tasks = nil
	s.Draft = nil
	return s
}
