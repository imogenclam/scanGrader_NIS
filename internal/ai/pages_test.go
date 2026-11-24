package ai

import (
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
)

func TestEachPage_PanicIsPageError(t *testing.T) {
	out := eachPage("тест", 3, 2, func(i int) (string, error) {
		if i == 1 {
			panic("сломался разбор ответа")
		}
		return fmt.Sprint("лист ", i), nil
	})
	if out[0].text != "лист 0" || out[2].text != "лист 2" || out[0].err != nil || out[2].err != nil {
		t.Fatalf("целые листы потерялись: %+v", out)
	}
	if !errors.Is(out[1].err, errPagePanic) {
		t.Fatalf("упавший лист выглядит распознанным: %+v", out[1])
	}
}

func TestEachPage_Concurrency(t *testing.T) {
	var now, peak int32
	eachPage("тест", 10, 3, func(int) (string, error) {
		n := atomic.AddInt32(&now, 1)
		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}
		atomic.AddInt32(&now, -1)
		return "", nil
	})
	if peak > 3 {
		t.Fatalf("одновременно %d, предел 3", peak)
	}
}
