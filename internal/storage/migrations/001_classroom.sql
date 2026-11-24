CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL,
    login_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student','teacher')),
    full_name TEXT NOT NULL,
    group_number TEXT NOT NULL DEFAULT ''
);
CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE subjects (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    invite_code TEXT NOT NULL UNIQUE, created_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE subject_teachers (
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    teacher_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(subject_id, teacher_id)
);
CREATE TABLE subject_students (
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    student_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(subject_id, student_id)
);
CREATE INDEX enrolled_by_student ON subject_students(student_id,subject_id);
CREATE TABLE assignments (
    id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL REFERENCES subjects(id),
    title TEXT NOT NULL, statement TEXT NOT NULL, tasks TEXT NOT NULL,
    reference_file TEXT NOT NULL, reference_version TEXT NOT NULL
);
CREATE INDEX assignments_by_subject ON assignments(subject_id,id);
CREATE TABLE submissions (
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id),
    student_id INTEGER NOT NULL REFERENCES users(id), pdf_file TEXT NOT NULL,
    reference_version TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','draft','manual','approved')),
    reason TEXT NOT NULL DEFAULT '', draft TEXT, final TEXT,
    approved_by INTEGER REFERENCES users(id), approved_at TEXT,
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(assignment_id,student_id)
);
CREATE INDEX submissions_queue ON submissions(state,id);
