package ratelimit

import (
	"sync"
	"testing"
	"time"
)

func TestLoginLimiter_NotBlockedInitially(t *testing.T) {
	l := NewLogin()
	if l.IsBlocked("1.2.3.4") {
		t.Error("new IP should not be blocked initially")
	}
}

func TestLoginLimiter_BlocksAfterMaxAttempts(t *testing.T) {
	l := NewLogin()
	ip := "1.2.3.4"
	for i := 0; i < LoginAttempts-1; i++ {
		blocked := l.RecordFailure(ip)
		if blocked {
			t.Errorf("should not be blocked after attempt %d of %d", i+1, LoginAttempts)
		}
		if l.IsBlocked(ip) {
			t.Errorf("IsBlocked should be false after attempt %d", i+1)
		}
	}

	blocked := l.RecordFailure(ip)
	if !blocked {
		t.Error("5th failure should return blocked=true")
	}
	if !l.IsBlocked(ip) {
		t.Error("IsBlocked should return true after max attempts")
	}
}

func TestLoginLimiter_RecordSuccessResetsCounter(t *testing.T) {
	l := NewLogin()
	ip := "5.5.5.5"

	for i := 0; i < LoginAttempts-1; i++ {
		l.RecordFailure(ip)
	}
	l.RecordSuccess(ip)

	if l.IsBlocked(ip) {
		t.Error("after RecordSuccess IP should not be blocked")
	}

	for i := 0; i < LoginAttempts-1; i++ {
		if l.RecordFailure(ip) {
			t.Errorf("should not block again after reset, attempt %d", i+1)
		}
	}
}

func TestLoginLimiter_DifferentIPsIndependent(t *testing.T) {
	l := NewLogin()
	ip1, ip2 := "10.0.0.1", "10.0.0.2"

	for i := 0; i < LoginAttempts; i++ {
		l.RecordFailure(ip1)
	}

	if !l.IsBlocked(ip1) {
		t.Error("ip1 should be blocked")
	}
	if l.IsBlocked(ip2) {
		t.Error("ip2 should not be affected by ip1 failures")
	}
}

func TestLoginLimiter_ReturnsTrueOnExactlyMaxAttempts(t *testing.T) {
	l := NewLogin()
	ip := "9.9.9.9"

	var lastResult bool
	for i := 0; i < LoginAttempts; i++ {
		lastResult = l.RecordFailure(ip)
	}
	if !lastResult {
		t.Error("RecordFailure must return true on the attempt that causes block")
	}
}

func TestLoginLimiter_BlockedIPStaysBlocked(t *testing.T) {
	l := NewLogin()
	ip := "2.2.2.2"

	for i := 0; i < LoginAttempts; i++ {
		l.RecordFailure(ip)
	}

	for i := 0; i < 5; i++ {
		l.RecordFailure(ip)
		if !l.IsBlocked(ip) {
			t.Errorf("blocked IP should remain blocked on extra attempt %d", i+1)
		}
	}
}

func TestLoginLimiter_Concurrent(t *testing.T) {
	l := NewLogin()
	ip := "3.3.3.3"

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l.RecordFailure(ip)
		}()
	}
	wg.Wait()

	if !l.IsBlocked(ip) {
		t.Error("IP must be blocked after concurrent failures")
	}
}

func TestLoginLimiterStopTwice(t *testing.T) {
	l := New(1, time.Minute, time.Minute)
	l.Stop()
	l.Stop()
	l.RecordFailure("x")
	if !l.IsBlocked("x") {
		t.Error("после Stop лимитер должен продолжать считать попытки")
	}
}
