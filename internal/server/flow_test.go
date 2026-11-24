package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"scangrader/internal/grading"
	"scangrader/internal/pdf"
)

func TestMain(m *testing.M) { pdf.ServePDFHelper(); os.Exit(m.Run()) }

type actor struct {
	url    string
	client *http.Client
}

func newActor(url string) actor {
	jar, _ := cookiejar.New(nil)
	return actor{url, &http.Client{Jar: jar}}
}
func (a actor) call(t *testing.T, method, path, typ string, body []byte, accept ...int) []byte {
	t.Helper()
	req, err := http.NewRequest(method, a.url+"/api/"+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if typ != "" {
		req.Header.Set("Content-Type", typ)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range accept {
		if resp.StatusCode == status {
			return raw
		}
	}
	t.Fatalf("%s %s: %d %s", method, path, resp.StatusCode, raw)
	return nil
}
func (a actor) json(t *testing.T, method, path, body string, status int) []byte {
	t.Helper()
	return a.call(t, method, path, "application/json", []byte(body), status)
}
func (a actor) get(t *testing.T, path string, status int) []byte {
	t.Helper()
	return a.call(t, "GET", path, "", nil, status)
}
func uploadBody(t *testing.T, fields map[string]string, key, name string, body []byte) (string, []byte) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	f, err := w.CreateFormFile(key, name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(body); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	return w.FormDataContentType(), buf.Bytes()
}
func syntheticPDF(t *testing.T, pages int) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 320, 320))
	for y := 0; y < 320; y++ {
		for x := 0; x < 320; x++ {
			img.SetGray(x, y, color.Gray{Y: uint8((x + y) % 256)})
		}
	}
	var jpg, doc bytes.Buffer
	if err := jpeg.Encode(&jpg, img, nil); err != nil {
		t.Fatal(err)
	}
	parts := make([]io.Reader, pages)
	for i := range parts {
		parts[i] = bytes.NewReader(jpg.Bytes())
	}
	if err := api.ImportImages(nil, &doc, parts, nil, nil); err != nil {
		t.Fatal(err)
	}
	return doc.Bytes()
}

func TestClassroomFromPublicationToApprovedFractionalGrade(t *testing.T) {
	t.Setenv("SG_SMTP_HOST", "")
	dir := t.TempDir()
	a, err := Open(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	pass, err := a.SeedTeacher()
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.SeedTeacher()
	if err != nil || again != "" {
		t.Fatal("повторная инициализация изменила преподавателя", err)
	}
	ts := httptest.NewServer(a.Routes(http.NotFoundHandler()))
	defer ts.Close()
	teacher, student, other := newActor(ts.URL), newActor(ts.URL), newActor(ts.URL)
	data, _ := json.Marshal(map[string]string{"login": "teacher", "password": pass})
	teacher.json(t, "POST", "login", string(data), 200)
	registerTestUser(t, student, dir, "stu1", "Тестовый Студент", "")
	registerTestUser(t, other, dir, "stu2", "Другой Студент", "МАТ-02")
	subject := teacher.json(t, "POST", "subjects", `{"title":"Анализ"}`, 201)
	var created struct {
		ID   int
		Code string `json:"invite_code"`
	}
	if err = json.Unmarshal(subject, &created); err != nil || len(created.Code) != 6 {
		t.Fatalf("код %s, %v", subject, err)
	}
	joinBody := fmt.Sprintf(`{"code":" %s "}`, strings.ToLower(created.Code))
	student.json(t, "POST", "subjects/join", joinBody, 400)
	student.json(t, "PUT", "profile", `{"full_name":"Тестовый Студент","group":"МАТ-01"}`, 200)
	student.json(t, "POST", "subjects/join", joinBody, 200)
	student.json(t, "POST", "subjects/join", joinBody, 200)
	var subjects []struct{ ID int }
	if err = json.Unmarshal(student.get(t, "subjects", 200), &subjects); err != nil || len(subjects) != 1 {
		t.Fatal("не сохранилось участие", err)
	}
	reference := []byte("Эталон: теорема и вычисление. $x=2$")
	formFields := map[string]string{"title": "Работа 1", "statement": "Решите три задачи", "tasks": `[{"number":1,"max":1},{"number":2,"max":1},{"number":3,"max":1}]`}
	typ, body := uploadBody(t, formFields, "reference", "solutions.tex", reference)
	target := fmt.Sprintf("subjects/%d/assignments", created.ID)
	student.call(t, "POST", target, typ, body, 403)
	published := teacher.call(t, "POST", target, typ, body, 201)
	var assignmentID struct{ ID int }
	if err = json.Unmarshal(published, &assignmentID); err != nil {
		t.Fatal(err)
	}
	assignmentPath := fmt.Sprintf("assignments/%d", assignmentID.ID)
	other.get(t, assignmentPath, 403)
	student.get(t, assignmentPath+"/reference", 403)
	if result := teacher.get(t, assignmentPath+"/reference", 200); !bytes.Equal(result, reference) {
		t.Fatal("потерян эталон")
	}
	if bytes.Contains(student.get(t, assignmentPath, 200), reference) {
		t.Fatal("эталон в ответе студенту")
	}
	submitPath := assignmentPath + "/submissions"
	badTyp, bad := uploadBody(t, nil, "file", "work.pdf", []byte("%PDF-invalid"))
	student.call(t, "POST", submitPath, badTyp, bad, 400)
	manyTyp, many := uploadBody(t, nil, "file", "work.pdf", syntheticPDF(t, 6))
	student.call(t, "POST", submitPath, manyTyp, many, 400)
	original := syntheticPDF(t, 1)
	typ, body = uploadBody(t, nil, "file", "work.pdf", original)
	other.call(t, "POST", submitPath, typ, body, 403)
	var wg sync.WaitGroup
	var ids [2]struct{ ID int }
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			reply := student.call(t, "POST", submitPath, typ, body, 200, 201)
			if err := json.Unmarshal(reply, &ids[i]); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ids[0].ID != ids[1].ID || ids[0].ID == 0 {
		t.Fatalf("повторная сдача: %v", ids)
	}
	files, err := filepath.Glob(filepath.Join(dir, "files", "work-*.pdf"))
	if err != nil || len(files) != 1 {
		t.Fatalf("сохранено PDF: %v", files)
	}
	path := fmt.Sprintf("submissions/%d", ids[0].ID)
	other.get(t, path, 403)
	other.get(t, path+"/pdf", 403)
	if !bytes.Equal(original, teacher.get(t, path+"/pdf", 200)) {
		t.Fatal("изменился оригинал")
	}
	draft := `[{"number":1,"score":1,"comment":"Верно."},{"number":2,"score":0.3,"comment":"Не доказан переход."},{"number":3,"score":0.7,"comment":"Ошибка при сложении."}]`
	a.review = func(ctx context.Context, file, title, statement, ref string, tasks []grading.Task) ([]grading.Grade, error) {
		if _, err := os.Stat(file); err != nil {
			return nil, err
		}
		if ref != string(reference) || len(tasks) != 3 {
			return nil, fmt.Errorf("нет эталона или максимумов")
		}
		var grades []grading.Grade
		err := json.Unmarshal([]byte(draft), &grades)
		return grades, err
	}
	if worked, err := a.next(context.Background()); err != nil || !worked {
		t.Fatal("обработка сдачи", err)
	}
	if !bytes.Contains(teacher.get(t, path, 200), []byte(`"score":0.3`)) {
		t.Fatal("нет дробного черновика")
	}
	studentView := student.get(t, path, 200)
	if bytes.Contains(studentView, []byte(`"draft"`)) || !bytes.Contains(studentView, []byte(`"waiting"`)) {
		t.Fatalf("черновик раскрыт: %s", studentView)
	}
	adjusted := strings.Replace(draft, "0.3", "0.5", 1)
	teacher.json(t, "POST", path+"/approve", `{"grades":`+strings.Replace(adjusted, "0.5", "1.2", 1)+`}`, 400)
	student.json(t, "POST", path+"/approve", `{"grades":`+adjusted+`}`, 403)
	teacher.json(t, "POST", path+"/approve", `{"grades":`+adjusted+`}`, 200)
	approved := student.get(t, path, 200)
	if !bytes.Contains(approved, []byte(`"score":0.5`)) || bytes.Contains(approved, []byte(`"draft"`)) {
		t.Fatalf("итог: %s", approved)
	}
	if !bytes.Contains(teacher.get(t, path, 200), []byte(`"score":0.3`)) {
		t.Fatal("черновик затёрт итогом")
	}
	other.json(t, "POST", "subjects/join", joinBody, 200)
	other.get(t, path+"/pdf", 403)
	a.review = nil
	manualReply := other.call(t, "POST", submitPath, typ, body, 201)
	var manualID struct{ ID int }
	if err = json.Unmarshal(manualReply, &manualID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.next(context.Background()); err != nil {
		t.Fatal(err)
	}
	manualPath := fmt.Sprintf("submissions/%d", manualID.ID)
	if !bytes.Contains(teacher.get(t, manualPath, 200), []byte(`"manual"`)) {
		t.Fatal("нет ручной проверки при отключённом ИИ")
	}
	teacher.json(t, "POST", manualPath+"/retry", "{}", 409)
	other.json(t, "POST", manualPath+"/retry", "{}", 403)
	a.review = func(context.Context, string, string, string, string, []grading.Task) ([]grading.Grade, error) {
		return nil, fmt.Errorf("искусственный отказ адаптера")
	}
	if !bytes.Contains(teacher.get(t, manualPath, 200), []byte(`"can_retry":true`)) {
		t.Fatal("нет повторной проверки при подключённом адаптере")
	}
	teacher.json(t, "POST", manualPath+"/retry", "{}", 200)
	teacher.json(t, "POST", manualPath+"/retry", "{}", 409)
	if worked, err := a.next(context.Background()); err != nil || !worked {
		t.Fatal("повторная обработка", err)
	}
	teacher.json(t, "POST", manualPath+"/retry", "{}", 409)
	teacher.json(t, "POST", manualPath+"/approve", `{"grades":`+adjusted+`}`, 200)
	student.json(t, "POST", "logout", "{}", 204)
	student.get(t, path, 401)
}
