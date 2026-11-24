package grading

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode/utf8"
)

type Task struct {
	Number int     `json:"number"`
	Max    float64 `json:"max"`
}

type Grade struct {
	Number int `json:"number"`
	// nil означает пропуск. Ноль является допустимым баллом.
	Score   *float64 `json:"score"`
	Comment string   `json:"comment"`
}

func ValidateTasks(tasks []Task) error {
	if len(tasks) == 0 || len(tasks) > 100 {
		return fmt.Errorf("укажите от 1 до 100 задач")
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].Number < tasks[j].Number })
	for i, task := range tasks {
		if task.Number < 1 || task.Number > 1000 || (i > 0 && tasks[i-1].Number == task.Number) {
			return fmt.Errorf("номера задач должны быть положительными и уникальными")
		}
		if !(task.Max > 0 && task.Max <= 10000) {
			return fmt.Errorf("проверьте максимум для задачи %d", task.Number)
		}
	}
	return nil
}

// Validate приводит строки черновика и итоговой оценки к порядку задач задания.
func Validate(tasks []Task, grades []Grade) error {
	if len(tasks) == 0 || len(tasks) != len(grades) {
		return fmt.Errorf("нужен результат для каждой задачи")
	}
	sort.Slice(grades, func(i, j int) bool { return grades[i].Number < grades[j].Number })
	for i, task := range tasks {
		row := &grades[i]
		if row.Number != task.Number {
			return fmt.Errorf("проверьте номер задачи %d", task.Number)
		}
		if row.Score == nil || math.IsNaN(*row.Score) || *row.Score < 0 || *row.Score > task.Max {
			return fmt.Errorf("для задачи %d укажите балл от 0 до %g", task.Number, task.Max)
		}
		row.Comment = strings.TrimSpace(row.Comment)
		if row.Comment == "" || utf8.RuneCountInString(row.Comment) > 1000 {
			return fmt.Errorf("для задачи %d нужен комментарий до 1000 знаков", task.Number)
		}
	}
	return nil
}
