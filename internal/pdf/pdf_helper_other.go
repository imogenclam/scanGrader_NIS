//go:build !linux

package pdf

import (
	"context"
	"os"
	"os/exec"
)

// вне Linux остаётся только сторож памяти
func prepareHelperProcess(int64) {}

func helperCommand(ctx context.Context, args []string) (*exec.Cmd, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return exec.CommandContext(ctx, exe, args...), nil
}

func runExternal(cmd *exec.Cmd) error { return cmd.Run() }
