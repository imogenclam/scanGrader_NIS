package pdf

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"
)

var gsPath string
var gsOnce sync.Once

// gs рисует страницы для ИИ-проверки; два процесса ограничивают нагрузку на ВМ
const gsConcurrency = 2

var gsSlots = make(chan struct{}, gsConcurrency)

func acquireGS(timeout time.Duration) bool {
	select {
	case gsSlots <- struct{}{}:
		return true
	default:
	}
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case gsSlots <- struct{}{}:
		return true
	case <-t.C:
		return false
	}
}

func releaseGS() { <-gsSlots }

func findGhostscript() string {
	gsOnce.Do(func() {
		for _, name := range []string{"gs", "gswin64c", "gswin32c"} {
			if p, err := exec.LookPath(name); err == nil {
				gsPath = p
				break
			}
		}
		if gsPath == "" {
			slog.Warn("Ghostscript не найден, рендер использует pdftoppm, если он установлен")
		}
	})
	return gsPath
}

func Render(parent context.Context, pdfPath string, maxPages int) ([]string, func(), error) {
	noop := func() {}
	gs := findGhostscript()
	ppm, _ := exec.LookPath("pdftoppm")
	if gs == "" && ppm == "" {
		return nil, noop, fmt.Errorf("для чтения PDF нужен Ghostscript или pdftoppm")
	}
	if !acquireGS(60 * time.Second) {
		return nil, noop, fmt.Errorf("очередь Ghostscript занята")
	}
	defer releaseGS()

	dir, err := os.MkdirTemp("", "aireview-")
	if err != nil {
		return nil, noop, err
	}
	cleanup := func() { os.RemoveAll(dir) }

	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	defer cancel()

	args := []string{
		"-sDEVICE=jpeggray",
		"-r150",
		"-dJPEGQ=80",
		"-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
	}
	if maxPages > 0 {
		args = append(args, "-dLastPage="+strconv.Itoa(maxPages))
	}
	pattern := filepath.Join(dir, "p-%03d.jpg")
	args = append(args, "-sOutputFile="+pattern, "-f", pdfPath)

	cmd := exec.CommandContext(ctx, gs, args...)
	if gs == "" {
		cmd = exec.CommandContext(ctx, ppm, "-r", "150", "-scale-to", "2400", "-f", "1", "-l", strconv.Itoa(maxPages), "-jpeg", pdfPath, filepath.Join(dir, "p"))
	}
	if err := runExternal(cmd); err != nil {
		cleanup()
		return nil, noop, err
	}
	pages, _ := filepath.Glob(filepath.Join(dir, "p-*.jpg"))
	if len(pages) == 0 {
		cleanup()
		return nil, noop, fmt.Errorf("gs не отрендерил ни одной страницы")
	}
	sort.Strings(pages)
	return pages, cleanup, nil
}
