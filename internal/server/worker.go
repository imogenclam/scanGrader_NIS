package server

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"scangrader/internal/ai"
	"scangrader/internal/grading"
)

func (a *App) notify() {
	select {
	case a.wake <- struct{}{}:
	default:
	}
}

// Очередь хранится в SQLite. Один обработчик обслуживает экземпляр на учебной ВМ.
func (a *App) Start() error {
	if _, err := a.db.Exec(`UPDATE submissions SET state='manual',reason='Обработка прервана перезапуском сервера' WHERE state='processing'`); err != nil {
		return err
	}
	if _, err := a.db.Exec("DELETE FROM sessions WHERE expires_at<=?", time.Now().Unix()); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		tick := time.NewTicker(3 * time.Second)
		defer tick.Stop()
		for ctx.Err() == nil {
			worked, err := a.next(ctx)
			if err != nil && ctx.Err() == nil {
				slog.Error("очередь проверок", "err", err)
			}
			if worked && err == nil {
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-a.wake:
			case <-tick.C:
			}
		}
	}()
	return nil
}

type reviewResult struct {
	id          int
	draft       string
	reason      string
	failedSaves int
}

func (a *App) next(ctx context.Context) (bool, error) {
	pending := a.unsaved
	a.unsaved = nil
	var saveErr error
	for _, result := range pending {
		if err := a.saveReview(ctx, result); err != nil {
			saveErr = errors.Join(saveErr, err)
		}
	}
	worked, err := a.gradeNext(ctx)
	return worked || len(pending) > 0, errors.Join(saveErr, err)
}

func (a *App) gradeNext(ctx context.Context) (bool, error) {
	var id, assignmentID int
	var file, version string
	err := a.db.QueryRowContext(ctx, `UPDATE submissions SET state='processing'
        WHERE id=(SELECT id FROM submissions WHERE state='queued' ORDER BY id LIMIT 1) AND state='queued'
        RETURNING id,assignment_id,pdf_file,reference_version`).Scan(&id, &assignmentID, &file, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	work, stop := context.WithTimeout(ctx, 4*time.Minute)
	defer stop()
	draft, err := a.process(work, assignmentID, file, version)
	result := reviewResult{id: id}
	if err == nil {
		var raw []byte
		raw, err = json.Marshal(draft)
		result.draft = string(raw)
	}
	if err != nil {
		result.reason = "Сервис проверки не смог обработать работу. Проверьте PDF вручную."
		if errors.Is(err, ai.ErrNotConfigured) {
			result.reason = "ИИ-проверка не настроена. Доступна ручная проверка."
		} else {
			slog.Warn("ИИ-проверка", "submission", id, "err", err)
		}
	}
	// При остановке сервера даём уже полученному результату время записаться.
	saveCtx, cancelSave := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelSave()
	return true, a.saveReview(saveCtx, result)
}

func (a *App) saveReview(ctx context.Context, result reviewResult) error {
	const maxDraftSaves = 3
	reason := result.reason
	var err error
	if reason == "" {
		_, err = a.db.ExecContext(ctx, `UPDATE submissions SET state='draft',draft=?,reason='' WHERE id=? AND state='processing'`, result.draft, result.id)
		if err == nil {
			return nil
		}
		result.failedSaves++
		if result.failedSaves >= maxDraftSaves {
			reason = "Не удалось сохранить черновик ИИ. Проверьте работу вручную."
		}
	}
	if reason != "" {
		_, manualErr := a.db.ExecContext(ctx, `UPDATE submissions SET state='manual',reason=? WHERE id=? AND state='processing'`, reason, result.id)
		if manualErr == nil {
			if err != nil {
				slog.Warn("черновик передан на ручную проверку", "submission", result.id, "err", err)
			}
			return nil
		}
		err = errors.Join(err, manualErr)
	}
	a.unsaved = append(a.unsaved, result)
	return fmt.Errorf("запись результата сдачи %d: %w", result.id, err)
}

func (a *App) process(ctx context.Context, assignmentID int, file, version string) (rows []grading.Grade, err error) {
	defer func() {
		if caught := recover(); caught != nil {
			err = fmt.Errorf("сбой обработчика проверки: %v", caught)
		}
	}()
	path := filepath.Join(a.files, file)
	if a.review == nil {
		return nil, ai.ErrNotConfigured
	}
	d, err := a.loadAssignment(assignmentID)
	if err != nil {
		return nil, err
	}
	ref, err := os.ReadFile(filepath.Join(a.files, d.RefFile))
	if err != nil {
		return nil, err
	}
	if d.Version != version || fmt.Sprintf("%x", sha256.Sum256(ref)) != version {
		return nil, errors.New("версия эталона не совпала")
	}
	rows, err = a.review(ctx, path, d.Title, d.Statement, string(ref), d.Tasks)
	if err != nil {
		return nil, err
	}
	return rows, grading.Validate(d.Tasks, rows)
}
