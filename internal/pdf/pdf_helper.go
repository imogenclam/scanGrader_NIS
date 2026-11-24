package pdf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"runtime/debug"
	"runtime/metrics"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"scangrader/internal/safe"
)

// Присланные PDF разбирает дочерний процесс того же бинаря: нехватка памяти
// или фатальная ошибка pdfcpu убивают его, а не сервер с живыми лекциями.
const (
	pdfHelperEnv    = "SG_PDF_HELPER"
	pdfHelperMemEnv = "SG_PDF_HELPER_MEM"
	// код выхода помощника, превысившего память
	pdfHelperOOMExit = 3
)

// потолок памяти помощника, тесты уменьшают
var pdfHelperMem int64 = 1536 << 20

// помощники для сдач и пометок; у фонового сжатия свой слот
var helperSlots = make(chan struct{}, 2)

// помощнику — только это, без ключей и паролей из окружения сервера
var helperEnvKeys = map[string]bool{"PATH": true, "TMPDIR": true, "TMP": true, "TEMP": true, "SYSTEMROOT": true}

// бинарь без ServePDFHelper в начале main запускал бы сам себя по кругу
var helperServed atomic.Bool

// ServePDFHelper выполняет работу помощника и завершает процесс; в обычном запуске ничего не делает.
func ServePDFHelper() {
	helperServed.Store(true)
	op := os.Getenv(pdfHelperEnv) // rules:allow go-getenv — связь с процессом-помощником, не настройка
	if op == "" {
		return
	}
	limit, err := strconv.ParseInt(os.Getenv(pdfHelperMemEnv), 10, 64) // rules:allow go-getenv — передаёт родитель
	if err != nil || limit <= 0 {
		limit = pdfHelperMem
	}
	prepareHelperProcess(limit)
	// без HOME pdfcpu завёл бы папку настроек во временной
	api.DisableConfigDir()
	safe.Go("pdf-helper-memory", func() { watchHelperMemory(limit) })

	code := 2
	switch op {
	case "shrink":
		if len(os.Args) == 3 {
			shrinkPDFImagesLocal(os.Args[1], os.Args[2])
			code = 0
		}
	case "check":
		if len(os.Args) == 2 {
			code = helperCheck(os.Args[1])
		}
	}
	os.Exit(code)
}

func watchHelperMemory(limit int64) {
	debug.SetMemoryLimit(limit * 3 / 4)
	sample := []metrics.Sample{{Name: "/memory/classes/total:bytes"}}
	for {
		metrics.Read(sample)
		if int64(sample[0].Value.Uint64()) > limit {
			fmt.Fprintln(os.Stderr, "PDF-помощник: превышен предел памяти")
			os.Exit(pdfHelperOOMExit)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func helperEnv(op string) []string {
	mem := pdfHelperMem
	if op == "shrink" {
		mem = shrinkHelperMem
	}
	env := []string{
		"GOMAXPROCS=1",
		pdfHelperEnv + "=" + op,
		pdfHelperMemEnv + "=" + strconv.FormatInt(mem, 10),
	}
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); helperEnvKeys[strings.ToUpper(k)] {
			env = append(env, kv)
		}
	}
	return env
}

// runPDFHelper запускает помощника и возвращает его вывод; слот helperSlots берёт вызывающий
func runPDFHelper(ctx context.Context, op string, args ...string) (string, error) {
	if !helperServed.Load() {
		return "", errors.New("PDF-помощник: в main или TestMain не вызван ServePDFHelper")
	}
	cmd, err := helperCommand(ctx, args)
	if err != nil {
		return "", err
	}
	cmd.Env = helperEnv(op)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = os.Stderr
	err = cmd.Run()
	return out.String(), err
}
