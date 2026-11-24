package pdf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/pdfcpu/pdfcpu/pkg/filter"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"io"
	"net/http"
	"time"
)

const MaxPages = 5
const MaxBytes = 20 << 20
const maxSubmitPages = MaxPages
const mergeTimeout = 60 * time.Second
const mergeSlotWait = 30 * time.Second

var errPDFUnreadable = errors.New("PDF работы не читается")

type UploadError struct {
	Code int
	msg  string
}

func (e *UploadError) Error() string { return e.msg }

func badUpload(format string, args ...any) *UploadError {
	return &UploadError{http.StatusBadRequest, fmt.Sprintf(format, args...)}
}

func acquireHelperSlot(ctx context.Context) bool {
	t := time.NewTimer(mergeSlotWait)
	defer t.Stop()
	select {
	case helperSlots <- struct{}{}:
		return true
	case <-ctx.Done():
	case <-t.C:
	}
	return false
}

const (
	maxStreamBytes = 256 << 20
	maxFileDecoded = 1 << 30
)

// pdfcpu при склейке потоки не распаковывает, проверяем сами с пределом
func hasDecodeBomb(ctx *model.Context) bool {
	var total int64
	for _, e := range ctx.Table {
		if e == nil {
			continue
		}
		sd, ok := e.Object.(types.StreamDict)
		if !ok {
			continue
		}
		limit := min(int64(maxStreamBytes), maxFileDecoded-total)
		n := decodedSize(sd, limit)
		if n > limit {
			return true
		}
		total += n
	}
	return false
}

// Эвристика: кодеки картинок и неизвестные фильтры считаем по сырому размеру, дальше защищают процесс и сторож.
func decodedSize(sd types.StreamDict, limit int64) int64 {
	data := sd.Raw
	for _, f := range sd.FilterPipeline {
		switch f.Name {
		case filter.DCT, filter.JPX, filter.JBIG2, filter.CCITTFax:
			return int64(len(data))
		}
		fi, err := filter.NewFilter(f.Name, filterParms(f.DecodeParms))
		if err != nil {
			return int64(len(data))
		}
		r, err := fi.DecodeLength(bytes.NewReader(data), limit+1)
		if r == nil || (err != nil && !errors.Is(err, io.EOF)) {
			return int64(len(data))
		}
		var buf bytes.Buffer
		if _, err := io.Copy(&buf, io.LimitReader(r, limit+1)); err != nil {
			return int64(len(data))
		}
		if data = buf.Bytes(); int64(len(data)) > limit {
			break
		}
	}
	return int64(len(data))
}

// как в pdfcpu: числа и логические значения из DecodeParms
func filterParms(d types.Dict) map[string]int {
	m := map[string]int{}
	for k, v := range d {
		switch x := v.(type) {
		case types.Integer:
			m[k] = x.Value()
		case types.Boolean:
			if x.Value() {
				m[k] = 1
			} else {
				m[k] = 0
			}
		}
	}
	return m
}

func Compress(original, copyPath string) bool {
	return shrinkPDFImages(original, copyPath)
}
