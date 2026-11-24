package grading

import (
	"encoding/json"
	"testing"
)

func TestFractionalDraftNeedsEveryTaskAndComment(t *testing.T) {
	tasks := []Task{{1, 1}, {2, 1}, {3, 1}}
	raw := []byte(`[{"number":3,"score":0.7,"comment":"Арифметическая ошибка."},{"number":1,"score":1,"comment":"Верно."},{"number":2,"score":0.3,"comment":"Не доказан переход."}]`)
	var grades []Grade
	if err := json.Unmarshal(raw, &grades); err != nil {
		t.Fatal(err)
	}
	if err := Validate(tasks, grades); err != nil {
		t.Fatal(err)
	}
	if grades[1].Number != 2 || *grades[1].Score != 0.3 {
		t.Fatalf("задание 2: %+v", grades[1])
	}
	for _, wrong := range []string{
		`[{"number":1,"score":1,"comment":"Верно."}]`,
		`[{"number":1,"score":0,"comment":"Нет ответа."},{"number":2,"score":1.2,"comment":"Ошибка."},{"number":3,"score":1,"comment":"Верно."}]`,
		`[{"number":1,"score":0,"comment":"Нет ответа."},{"number":1,"score":0,"comment":"Нет ответа."},{"number":3,"score":1,"comment":"Верно."}]`,
		`[{"number":1,"comment":"Нет ответа."},{"number":2,"score":0,"comment":"Нет ответа."},{"number":3,"score":1,"comment":"Верно."}]`,
		`[{"number":1,"score":0,"comment":" "},{"number":2,"score":0,"comment":"Ошибка."},{"number":3,"score":1,"comment":"Верно."}]`,
	} {
		var invalid []Grade
		if err := json.Unmarshal([]byte(wrong), &invalid); err != nil {
			t.Fatal(err)
		}
		if Validate(tasks, invalid) == nil {
			t.Errorf("некорректные оценки приняты: %s", wrong)
		}
	}
}
