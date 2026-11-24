// Package ratelimit — счётчики попыток по ключу (IP, пользователь) с блокировкой и middleware для маршрутов.
package ratelimit

import (
	"sync"
	"time"

	"scangrader/internal/safe"
)

const (
	// LoginAttempts — неудачных попыток до блокировки у NewLogin.
	LoginAttempts = 5
	attemptWindow = 15 * time.Minute
	lockDuration  = 15 * time.Minute
)

type ipEntry struct {
	failures    int
	firstFail   time.Time
	lockedUntil time.Time
}

type Limiter struct {
	mu      sync.Mutex
	entries map[string]*ipEntry

	maxAttempts  int
	window       time.Duration
	lockDuration time.Duration

	stop     chan struct{}
	stopOnce sync.Once
}

// New — после maxAttempts попыток за window ключ заблокирован на lock.
func New(maxAttempts int, window, lock time.Duration) *Limiter {
	l := &Limiter{
		entries:      make(map[string]*ipEntry),
		maxAttempts:  maxAttempts,
		window:       window,
		lockDuration: lock,
		stop:         make(chan struct{}),
	}
	safe.Go("очистка лимитера", l.cleanup)
	return l
}

// Stop останавливает фоновую чистку; вызывать при остановке сервера.
func (l *Limiter) Stop() {
	l.stopOnce.Do(func() { close(l.stop) })
}

// NewLogin — лимит входа и проверки кодов: 5 попыток за 15 минут.
func NewLogin() *Limiter {
	return New(LoginAttempts, attemptWindow, lockDuration)
}

func (l *Limiter) IsBlocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok {
		return false
	}
	if time.Now().Before(e.lockedUntil) {
		return true
	}

	if !e.lockedUntil.IsZero() {
		delete(l.entries, ip)
	}
	return false
}

// RetryAfter — сколько ещё ждать до снятия блокировки.
func (l *Limiter) RetryAfter(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		return 0
	}
	return max(0, time.Until(e.lockedUntil))
}

func (l *Limiter) RecordFailure(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok {
		e = &ipEntry{firstFail: time.Now()}
		l.entries[ip] = e
	}

	if time.Since(e.firstFail) > l.window {
		e.failures = 0
		e.firstFail = time.Now()
	}
	e.failures++
	if e.failures >= l.maxAttempts {
		e.lockedUntil = time.Now().Add(l.lockDuration)
		return true
	}
	return false
}

// Acquire проверяет блок и сразу учитывает попытку под одним замком, до сравнения пароля
// или кода: пачка параллельных запросов не проскочит лимит. Успех сбрасывает RecordSuccess.
func (l *Limiter) Acquire(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	e, ok := l.entries[key]
	if ok && !e.lockedUntil.IsZero() {
		if now.Before(e.lockedUntil) {
			return false
		}
		ok = false
	}
	if !ok {
		e = &ipEntry{firstFail: now}
		l.entries[key] = e
	}
	if now.Sub(e.firstFail) > l.window {
		e.failures = 0
		e.firstFail = now
	}
	e.failures++
	if e.failures >= l.maxAttempts {
		e.lockedUntil = now.Add(l.lockDuration)
	}
	return true
}

// без блокировки аккаунта
func (l *Limiter) Touch(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		e = &ipEntry{firstFail: time.Now()}
		l.entries[key] = e
	}
	if time.Since(e.firstFail) > l.window {
		e.failures = 0
		e.firstFail = time.Now()
	}
	e.failures++
	return e.failures
}

func (l *Limiter) Count(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || time.Since(e.firstFail) > l.window {
		return 0
	}
	return e.failures
}

func (l *Limiter) RecordSuccess(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, ip)
}

func (l *Limiter) cleanup() {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-t.C:
		}
		l.mu.Lock()
		now := time.Now()
		for ip, e := range l.entries {
			expired := e.lockedUntil.IsZero() && time.Since(e.firstFail) > l.window
			unlocked := !e.lockedUntil.IsZero() && now.After(e.lockedUntil)
			if expired || unlocked {
				delete(l.entries, ip)
			}
		}
		l.mu.Unlock()
	}
}
