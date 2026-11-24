package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"scangrader/internal/account"
)

func accountSite(t *testing.T) (*App, actor, string) {
	t.Helper()
	t.Setenv("SG_SMTP_HOST", "")
	dir := t.TempDir()
	app, err := Open(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	site := httptest.NewServer(app.Routes(http.NotFoundHandler()))
	t.Cleanup(site.Close)
	return app, newActor(site.URL), dir
}

func sendFields(t *testing.T, client actor, route string, fields map[string]string, status int) map[string]any {
	t.Helper()
	body, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	raw := client.json(t, "POST", route, string(body), status)
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

var codeLine = regexp.MustCompile("(?m)^Код: ([0-9]{6})\\r?$")

func lastMailCode(t *testing.T, dir, addr string) (string, int) {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(dir, "mail", "*.eml"))
	if err != nil {
		t.Fatal(err)
	}
	count, code := 0, ""
	for _, file := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		msg, err := mail.ReadMessage(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		if msg.Header.Get("To") != addr {
			continue
		}
		body, err := io.ReadAll(msg.Body)
		if err != nil {
			t.Fatal(err)
		}
		match := codeLine.FindSubmatch(body)
		if match == nil {
			t.Fatal("письмо должно содержать шестизначный код отдельной строкой")
		}
		count++
		code = string(match[1])
	}
	return code, count
}

func registerTestUser(t *testing.T, client actor, dir, login, fullName, group string) {
	t.Helper()
	email := login + "@example.org"
	sendFields(t, client, "register", map[string]string{
		"login": login, "password": "test-password", "email": email, "full_name": fullName, "group": group,
	}, 200)
	code, n := lastMailCode(t, dir, email)
	if n != 1 {
		t.Fatalf("число писем при регистрации: %d", n)
	}
	sendFields(t, client, "verify-email", map[string]string{"email": email, "code": code}, 200)
}

func TestRegistrationUsesOriginalFormUntilEmailIsConfirmed(t *testing.T) {
	app, client, dir := accountSite(t)
	const addr = "iris@example.org"
	for _, ident := range []string{addr, "missing-person"} {
		checked := sendFields(t, client, "auth/check", map[string]string{"login": ident}, 200)
		if checked["exists"] != true || checked["next"] != "password" {
			t.Fatal("первый шаг входа должен одинаково предлагать пароль")
		}
	}
	form := map[string]string{"login": "Ирис", "password": "first-password", "email": " Iris@EXAMPLE.ORG ", "full_name": "Ирис Иванова", "requested_role": "student"}
	start := sendFields(t, client, "register", form, 200)
	code, count := lastMailCode(t, dir, addr)
	response, _ := json.Marshal(start)
	if count != 1 || start["need_verify"] != true || start["local_delivery"] != true || strings.Contains(string(response), code) {
		t.Fatal("код должен поступить только в локальное письмо")
	}
	client.get(t, "me", 401)
	pending := sendFields(t, client, "login", map[string]string{"login": addr, "password": "first-password"}, 401)
	if pending["pending_registration"] != true {
		t.Fatal("вход должен предлагать закончить регистрацию")
	}
	form["login"], form["password"], form["requested_role"], form["teacher_note"] = "other", "second-password", "teacher", "Лицей"
	repeat := sendFields(t, client, "register", form, 200)
	if repeat["teacher_request"] != false {
		t.Fatal("повторный запрос подменил роль незаконченной регистрации")
	}
	if _, count := lastMailCode(t, dir, addr); count != 1 {
		t.Fatal("повторное письмо до истечения минуты")
	}
	if _, err := app.db.Exec("UPDATE email_verifications SET sent_at=0 WHERE email=?", addr); err != nil {
		t.Fatal(err)
	}
	sendFields(t, client, "register", form, 200)
	resent, count := lastMailCode(t, dir, addr)
	if count != 2 || resent != code {
		t.Fatal("при повторной отправке ожидался исходный код")
	}
	created := sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": code}, 200)
	if created["success"] != true || created["user_type"] != "student" || !bytes.Contains(client.get(t, "me", 200), []byte("Ирис Иванова")) {
		t.Fatal("подтверждение должно создать исходный аккаунт и открыть сессию")
	}
	sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": code}, 400)
	logout, err := client.client.Post(client.url+"/logout", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	logout.Body.Close()
	if logout.StatusCode != 204 {
		t.Fatalf("POST /logout: %d", logout.StatusCode)
	}
	client.get(t, "me", 401)
	sendFields(t, client, "login", map[string]string{"login": addr, "password": "second-password"}, 401)
	result := sendFields(t, client, "login", map[string]string{"login": "ИРИС", "password": "first-password"}, 200)
	u, ok := result["user"].(map[string]any)
	if !ok || result["success"] != true || result["role"] != "student" || u["email"] != addr || u["user_type"] != "student" {
		t.Fatal("ответ входа должен поддерживать оба клиента")
	}
	form["email"], form["login"] = "another@example.org", "ирис"
	conflict := sendFields(t, client, "register", form, 409)
	if candidates, ok := conflict["suggestions"].([]any); conflict["field"] != "login" || !ok || len(candidates) == 0 {
		t.Fatal("конфликт логина должен предложить свободное имя")
	}
	form["login"], form["email"] = "another", addr
	if got := sendFields(t, client, "register", form, 409); got["field"] != "email" {
		t.Fatal("конфликт почты должен отмечать поле email")
	}
}

func TestVerifiedTeacherCanCreateOnlyOwnSubjects(t *testing.T) {
	app, client, dir := accountSite(t)
	password, err := app.SeedTeacher()
	if err != nil {
		t.Fatal(err)
	}
	owner := newActor(client.url)
	sendFields(t, owner, "login", map[string]string{"login": "teacher", "password": password}, 200)
	var subject struct{ ID int }
	if err := json.Unmarshal(owner.json(t, "POST", "subjects", `{"title":"Чужой предмет"}`, 201), &subject); err != nil {
		t.Fatal(err)
	}
	const addr = "teacher1@example.org"
	form := map[string]string{"login": "teacher1", "password": "new-teacher-password", "email": addr, "full_name": "Новый Преподаватель", "requested_role": "teacher"}
	invalid := sendFields(t, client, "register", form, 400)
	if invalid["field"] != "teacher_note" {
		t.Fatal("для преподавателя нужна информация о месте работы")
	}
	form["teacher_note"] = "Независимый лицей"
	sendFields(t, client, "register", form, 200)
	code, _ := lastMailCode(t, dir, addr)
	verify := sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": code}, 200)
	if verify["user_type"] != "teacher" || verify["teacher_request"] != false {
		t.Fatal("почта подтверждена, кабинет преподавателя должен открыться")
	}
	client.json(t, "POST", "subjects", `{"title":"Мой предмет"}`, 201)
	client.get(t, fmt.Sprintf("subjects/%d", subject.ID), 403)
	if bytes.Contains(client.get(t, "subjects", 200), []byte("Чужой предмет")) {
		t.Fatal("в кабинете есть чужой предмет")
	}
}

func TestPasswordResetRevokesSessionsAndConsumesOnlyItsCode(t *testing.T) {
	_, client, dir := accountSite(t)
	registerTestUser(t, client, dir, "student", "Другой Студент", "")
	const addr = "student@example.org"
	other := newActor(client.url)
	sendFields(t, other, "login", map[string]string{"login": addr, "password": "test-password"}, 200)
	known := sendFields(t, client, "password/forgot", map[string]string{"email": addr}, 200)
	unknown := sendFields(t, client, "password/forgot", map[string]string{"email": "unknown@example.org"}, 200)
	if known["message"] != unknown["message"] || known["success"] != true || unknown["local_delivery"] != true {
		t.Fatal("ответ выдал наличие аккаунта")
	}
	sendFields(t, client, "password/forgot", map[string]string{"email": addr}, 429)
	sendFields(t, client, "password/forgot", map[string]string{"email": "unknown@example.org"}, 429)
	code, n := lastMailCode(t, dir, addr)
	reg, _ := json.Marshal(known)
	if n != 2 || strings.Contains(string(reg), code) {
		t.Fatal("код сброса должен быть только в письме")
	}
	if _, n := lastMailCode(t, dir, "unknown@example.org"); n != 0 {
		t.Fatal("неизвестному адресу отправили письмо")
	}
	sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": code}, 400)
	reset := map[string]string{"email": addr, "code": code, "new_password": "short"}
	sendFields(t, client, "password/reset", reset, 400)
	reset["new_password"] = "replacement-password"
	sendFields(t, client, "password/reset", reset, 200)
	client.get(t, "me", 401)
	other.get(t, "me", 401)
	sendFields(t, client, "password/reset", reset, 400)
	sendFields(t, client, "login", map[string]string{"login": addr, "password": "test-password"}, 401)
	sendFields(t, client, "login", map[string]string{"login": addr, "password": "replacement-password"}, 200)
}

func TestVerificationPersistsAttemptsAndRejectsExpiredCode(t *testing.T) {
	app, client, dir := accountSite(t)
	const addr = "expiry@example.org"
	form := map[string]string{"email": addr, "login": "expiry", "password": "test-password", "full_name": "Первый Студент"}
	sendFields(t, client, "register", form, 200)
	code, _ := lastMailCode(t, dir, addr)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for range 3 {
		sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": wrong}, 400)
	}
	// Второй процесс открывает ту же базу, у него свои счётчики в памяти.
	reopened, err := Open(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	secondSite := httptest.NewServer(reopened.Routes(http.NotFoundHandler()))
	defer secondSite.Close()
	second := newActor(secondSite.URL)
	for range 2 {
		sendFields(t, second, "verify-email", map[string]string{"email": addr, "code": wrong}, 400)
	}
	sendFields(t, second, "verify-email", map[string]string{"email": addr, "code": code}, 400)
	second.get(t, "me", 401)
	client.get(t, "me", 401)
	form["email"], form["login"] = "expired@example.org", "expired"
	sendFields(t, client, "register", form, 200)
	expired, _ := lastMailCode(t, dir, form["email"])
	if _, err := app.db.Exec("UPDATE email_verifications SET expires_at=0 WHERE email=?", form["email"]); err != nil {
		t.Fatal(err)
	}
	sendFields(t, client, "verify-email", map[string]string{"email": form["email"], "code": expired}, 400)
	client.get(t, "me", 401)
}

func TestFreshRegistrationCodeCanBeUsedAfterGuessesBeforeSignup(t *testing.T) {
	_, client, dir := accountSite(t)
	const addr = "fresh@example.org"
	for range 5 {
		sendFields(t, client, "verify-email", map[string]string{"email": addr, "code": "123456"}, 400)
	}
	registerTestUser(t, client, dir, "fresh", "Новый Студент", "01")
	client.get(t, "me", 200)
}

func TestConcurrentRegistrationCannotIssueMailAfterAddressBecomesRegistered(t *testing.T) {
	app, client, dir := accountSite(t)
	registerTestUser(t, client, dir, "first", "Первый Студент", "01")
	// Состояние конкурентного запроса между предварительной проверкой адреса и сохранением анкеты.
	form := account.RegisterRequest{Login: "second", Email: "first@example.org", Password: "other-password", FullName: "Другой Студент"}
	if c, send, err := app.prepareRegistration(t.Context(), form); err == nil || send || c.Code != "" {
		t.Fatal("после регистрации на адрес может уйти новый действующий код")
	}
}
