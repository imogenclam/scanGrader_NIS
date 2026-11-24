package safe

import (
	"log/slog"
	"runtime/debug"
	"sync/atomic"
)

var panicCount int64

var OnPanic func()

func Go(name string, fn func()) {
	go func() {
		defer Recover(name)
		fn()
	}()
}

func Recover(name string) {
	rec := recover()
	if rec == nil {
		return
	}
	LogPanic(name, rec)
}

func LogPanic(name string, rec any) {
	if rec == nil {
		return
	}
	CountPanic()
	slog.Error("паника в горутине", "name", name, "panic", rec, "stack", string(debug.Stack()))
	if OnPanic != nil {
		OnPanic()
	}
}

// CountPanic — один счётчик паник горутин и обработчиков, его читает монитор.
func CountPanic() {
	atomic.AddInt64(&panicCount, 1)
}

func PanicCount() int64 { return atomic.LoadInt64(&panicCount) }
