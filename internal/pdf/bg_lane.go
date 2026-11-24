package pdf

import (
	"sync/atomic"
	"time"
)

// bgLane — очередь фоновой работы к пулу помощников: не больше одного слота за раз
type bgLane struct {
	pool   chan struct{}
	gate   chan struct{}
	queued atomic.Int32
	max    int32
}

func newBgLane(pool chan struct{}, maxQueue int32) *bgLane {
	return &bgLane{pool: pool, gate: make(chan struct{}, 1), max: maxQueue}
}

// acquire ждёт не дольше wait (0 — без предела); false — очередь полна или время вышло
func (l *bgLane) acquire(wait time.Duration) bool {
	if l.queued.Add(1) > l.max {
		l.queued.Add(-1)
		return false
	}
	defer l.queued.Add(-1)
	var timeout <-chan time.Time
	if wait > 0 {
		t := time.NewTimer(wait)
		defer t.Stop()
		timeout = t.C
	}
	select {
	case l.gate <- struct{}{}:
	case <-timeout:
		return false
	}
	select {
	case l.pool <- struct{}{}:
		return true
	case <-timeout:
		<-l.gate
		return false
	}
}

func (l *bgLane) release() {
	<-l.pool
	<-l.gate
}
