package pdf

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/unix"
)

// при нехватке памяти ОС убивает помощника, а не сервер
func prepareHelperProcess(limit int64) {
	if err := os.WriteFile("/proc/self/oom_score_adj", []byte("1000"), 0); err != nil {
		fmt.Fprintln(os.Stderr, "PDF-помощник: oom_score_adj:", err)
	}
	if err := syscall.Setpriority(syscall.PRIO_PROCESS, 0, 10); err != nil {
		fmt.Fprintln(os.Stderr, "PDF-помощник: приоритет:", err)
	}
	if !helperLimitAddrSpace {
		return
	}
	// запас на резервы рантайма Go, основной предел — сторож
	n := uint64(limit) + 2<<30
	if err := syscall.Setrlimit(syscall.RLIMIT_AS, &syscall.Rlimit{Cur: n, Max: n}); err != nil {
		fmt.Fprintln(os.Stderr, "PDF-помощник: RLIMIT_AS:", err)
	}
}

// /proc/self/exe переживает подмену бинаря при деплое
func helperCommand(ctx context.Context, args []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, "/proc/self/exe", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	return cmd, nil
}

// потолок памяти gs и pdftotext
const externalMemLimit = 1536 << 20

// runExternal запускает gs или pdftotext: ниже приоритетом, с потолком памяти, умирает вместе с сервером
func runExternal(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	if err := syscall.Setpriority(syscall.PRIO_PROCESS, pid, 10); err != nil && err != syscall.ESRCH {
		fmt.Fprintln(os.Stderr, "PDF: приоритет внешнего процесса:", err)
	}
	lim := unix.Rlimit{Cur: externalMemLimit, Max: externalMemLimit}
	if err := unix.Prlimit(pid, unix.RLIMIT_AS, &lim, nil); err != nil && err != unix.ESRCH {
		fmt.Fprintln(os.Stderr, "PDF: RLIMIT_AS внешнего процесса:", err)
	}
	return cmd.Wait()
}
