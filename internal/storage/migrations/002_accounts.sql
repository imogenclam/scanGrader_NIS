-- У аккаунтов из версии 1 и начального teacher подтверждённой почты пока нет.
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX users_by_email ON users(email) WHERE email != '';
ALTER TABLE users ADD COLUMN teacher_request TEXT NOT NULL DEFAULT '' CHECK(teacher_request IN ('','approved'));
ALTER TABLE users ADD COLUMN teacher_note TEXT NOT NULL DEFAULT '';

-- Для регистрации ключом служит адрес, для сброса пароля — reset:<адрес>.
CREATE TABLE email_verifications (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    data_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
);
CREATE INDEX verifications_expiry ON email_verifications(expires_at);
CREATE INDEX verifications_login ON email_verifications(json_extract(data_json,'$.login_key'));
CREATE INDEX sessions_by_user ON sessions(user_id);

ALTER TABLE submissions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count IN (0,1));
