package pdf

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) { ServePDFHelper(); os.Exit(m.Run()) }
