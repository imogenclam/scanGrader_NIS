//go:build !windows

package email

import "os"

func restrictDirectory(path string) error { return os.Chmod(path, 0700) }
