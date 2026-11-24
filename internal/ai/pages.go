package ai

import (
	"errors"
	"sync"

	"scangrader/internal/safe"
)

// упавший кусок не должен считаться распознанным пустым текстом
var errPagePanic = errors.New("сбой при распознавании")

type pageResult struct {
	text string
	err  error
}

// eachPage распознаёт n кусков работы, не больше conc одновременно.
func eachPage(name string, n, conc int, read func(i int) (string, error)) []pageResult {
	out := make([]pageResult, n)
	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	for i := range out {
		out[i].err = errPagePanic
		wg.Add(1)
		safe.Go(name, func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out[i].text, out[i].err = read(i)
		})
	}
	wg.Wait()
	return out
}
