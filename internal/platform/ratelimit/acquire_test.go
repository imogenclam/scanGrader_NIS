package ratelimit

import (
	"sync"
	"sync/atomic"
	"testing"
)

// сотня параллельных попыток: пропускаются ровно maxAttempts, остальные упираются в блок
func TestAcquire_ParallelBurstStopsAtLimit(t *testing.T) {
	l := NewLogin()
	defer l.Stop()
	var passed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Acquire("k") {
				passed.Add(1)
			}
		}()
	}
	wg.Wait()
	if got := passed.Load(); got != LoginAttempts {
		t.Fatalf("пропущено %d попыток, ожидалось %d", got, LoginAttempts)
	}
	if !l.IsBlocked("k") {
		t.Fatal("после пачки ключ не заблокирован")
	}
}

// успех сбрасывает счёт, следующие попытки снова проходят
func TestAcquire_SuccessResets(t *testing.T) {
	l := NewLogin()
	defer l.Stop()
	for i := 0; i < LoginAttempts-1; i++ {
		if !l.Acquire("k") {
			t.Fatalf("попытка %d отвергнута до лимита", i+1)
		}
	}
	l.RecordSuccess("k")
	for i := 0; i < LoginAttempts; i++ {
		if !l.Acquire("k") {
			t.Fatalf("после успеха попытка %d отвергнута", i+1)
		}
	}
	if l.Acquire("k") {
		t.Fatal("шестая попытка подряд прошла")
	}
}
