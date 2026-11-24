CREATE TABLE demo_actors (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    token TEXT NOT NULL UNIQUE
);

CREATE TABLE submissions (
    id INTEGER PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES demo_actors(id),
    student_id TEXT NOT NULL REFERENCES demo_actors(id),
    approved_by TEXT REFERENCES demo_actors(id),
    approved_at TEXT,
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CHECK (approved_by IS NULL OR approved_by = teacher_id)
);

CREATE TABLE submission_tasks (
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    number INTEGER NOT NULL CHECK (number > 0),
    max_score REAL NOT NULL CHECK (max_score > 0),
    draft_score REAL NOT NULL CHECK (draft_score BETWEEN 0 AND max_score),
    draft_comment TEXT NOT NULL,
    PRIMARY KEY (submission_id, number)
);

CREATE TABLE final_grades (
    submission_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    score REAL NOT NULL CHECK (score >= 0),
    comment TEXT NOT NULL,
    PRIMARY KEY (submission_id, number),
    FOREIGN KEY (submission_id, number) REFERENCES submission_tasks(submission_id, number)
);

-- Токены для локальной демонстрации генерирует Go при первом запуске.
INSERT INTO demo_actors (id, role, token)
VALUES ('teacher-demo', 'teacher', :teacherToken), ('student-demo', 'student', :studentToken);
INSERT INTO submissions (id, teacher_id, student_id)
VALUES (1, 'teacher-demo', 'student-demo');
INSERT INTO submission_tasks (submission_id, number, max_score, draft_score, draft_comment)
VALUES (1, 1, 1, 0.5, 'Проверьте вычисление.');

PRAGMA user_version = 1;
