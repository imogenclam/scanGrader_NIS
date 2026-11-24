package classroomstore

import (
	"database/sql"
	"time"
)

type ClassroomRepo struct{ DB *sql.DB }

type Subject struct {
	ID          int       `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	InviteCode  string    `json:"invite_code,omitempty"`
	CreatedBy   int       `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
	Archived    bool      `json:"-"`
}

type SubjectWithRole struct {
	Subject
	IsOwner      bool   `json:"-"`
	TeacherCount int    `json:"-"`
	StudentCount int    `json:"students"`
	AssignCount  int    `json:"assignments"`
	LatestTitle  string `json:"latest_title,omitempty"`
}
