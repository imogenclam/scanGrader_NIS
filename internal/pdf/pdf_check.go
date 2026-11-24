package pdf

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// pdfReport — что разбор PDF нашёл по листам
type pdfReport struct {
	Pages int
	// листов, на которых есть живой снимок
	ImagePages int
	// номера листов, которые не прочитались
	Bad []int
}

var errPDFHeavy = errors.New("PDF слишком тяжёлый")

var errPDFTooMany = errors.New("в PDF слишком много страниц")

const (
	// картинка меньше — значок или линия, а не снимок листа
	photoMinSide = 200
	// разброс яркости однотонного кадра с запасом на шум JPEG
	blankLumaRange = 8
)

// сдачи, отклонённые проверкой, и сжатые копии, не прошедшие её; с запуска
var (
	rejectedSubmissions atomic.Int64
	rejectedCompressed  atomic.Int64
)

// SubmitPDFStats — счётчики для монитора: отклонённые сдачи и забракованные сжатые копии.
func SubmitPDFStats() (rejected, compressRejected int64) {
	return rejectedSubmissions.Load(), rejectedCompressed.Load()
}

func checkPDFFile(path string) (pdfReport, error) {
	f, err := os.Open(path)
	if err != nil {
		return pdfReport{}, err
	}
	defer f.Close()
	ctx, err := api.ReadValidateAndOptimize(f, model.NewDefaultConfiguration())
	if err != nil || ctx == nil || ctx.PageCount == 0 {
		return pdfReport{}, errPDFUnreadable
	}
	if ctx.PageCount > maxSubmitPages {
		return pdfReport{}, errPDFTooMany
	}
	if hasDecodeBomb(ctx) {
		return pdfReport{}, errPDFHeavy
	}
	return checkPDFContext(ctx), nil
}

type imageVerdict int

const (
	imgSmall imageVerdict = iota
	imgPhoto
	imgBlank
	imgBroken
)

func checkPDFContext(ctx *model.Context) pdfReport {
	rep := pdfReport{Pages: ctx.PageCount}
	masks := softMasks(ctx)
	seen := map[int]imageVerdict{}
	for p := 1; p <= ctx.PageCount; p++ {
		bad := false
		_, _, inh, err := ctx.PageDict(p, false)
		if err != nil || inh == nil || !goodBox(inh.MediaBox) {
			bad = true
		}
		photos, blanks := 0, 0
		for _, nr := range pdfcpu.ImageObjNrs(ctx, p) {
			if masks[nr] {
				continue
			}
			v, ok := seen[nr]
			if !ok {
				v = checkImage(ctx, nr)
				seen[nr] = v
			}
			switch v {
			case imgBroken:
				bad = true
			case imgBlank:
				photos++
				blanks++
			case imgPhoto:
				photos++
			}
		}
		if photos > 0 && blanks == photos {
			bad = true
		}
		if bad {
			rep.Bad = append(rep.Bad, p)
		} else if photos > blanks {
			rep.ImagePages++
		}
	}
	return rep
}

// прозрачность картинки сама по себе однотонная, её не судим
func softMasks(ctx *model.Context) map[int]bool {
	m := map[int]bool{}
	for _, obj := range ctx.Optimize.ImageObjects {
		if ref := obj.ImageDict.IndirectRefEntry("SMask"); ref != nil {
			m[ref.ObjectNumber.Value()] = true
		}
	}
	return m
}

func goodBox(r *types.Rectangle) bool {
	if r == nil {
		return false
	}
	for _, v := range []float64{r.LL.X, r.LL.Y, r.UR.X, r.UR.Y} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return r.Width() > 0 && r.Height() > 0
}

func checkImage(ctx *model.Context, nr int) imageVerdict {
	obj := ctx.Optimize.ImageObjects[nr]
	if obj == nil || obj.ImageDict == nil {
		return imgBroken
	}
	sd := obj.ImageDict
	w, h := sd.IntEntry("Width"), sd.IntEntry("Height")
	if w == nil || h == nil || *w <= 0 || *h <= 0 {
		return imgBroken
	}
	if m := sd.BooleanEntry("ImageMask"); m != nil && *m {
		return imgSmall
	}
	if max(*w, *h) < photoMinSide {
		return imgSmall
	}
	img, err := pdfcpu.ExtractImage(ctx, sd, false, "", nr, false)
	if err != nil || img == nil {
		// JPX, JBIG2 и прочее Go не декодирует: размеры целы, верим
		return imgPhoto
	}
	switch img.FileType {
	case "jpg", "png":
	default:
		return imgPhoto
	}
	pic, _, err := image.Decode(img)
	if err != nil {
		return imgBroken
	}
	if uniform(pic) {
		return imgBlank
	}
	return imgPhoto
}

// однотонный кадр: чёрный с камеры или пустой холст. Смотрим каждый пиксель:
// редкие тонкие штрихи на выбеленном скане сетка пропускает
func uniform(img image.Image) bool {
	b := img.Bounds()
	if b.Empty() {
		return true
	}
	switch m := img.(type) {
	case *image.YCbCr:
		return flatPlane(m.Y[m.YOffset(b.Min.X, b.Min.Y):], m.YStride, b.Dx(), b.Dy())
	case *image.Gray:
		return flatPlane(m.Pix[m.PixOffset(b.Min.X, b.Min.Y):], m.Stride, b.Dx(), b.Dy())
	}
	lo, hi := uint8(255), uint8(0)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			v := color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y
			lo, hi = min(lo, v), max(hi, v)
		}
		if int(hi)-int(lo) > blankLumaRange {
			return false
		}
	}
	return true
}

// flatPlane — разброс яркости плоскости не больше blankLumaRange
func flatPlane(pix []uint8, stride, w, h int) bool {
	lo, hi := uint8(255), uint8(0)
	for y := 0; y < h; y++ {
		for _, v := range pix[y*stride : y*stride+w] {
			lo, hi = min(lo, v), max(hi, v)
		}
		if int(hi)-int(lo) > blankLumaRange {
			return false
		}
	}
	return true
}

// helperCheck работает в помощнике: одна строка с итогом разбора
func helperCheck(path string) int {
	rep, err := checkPDFFile(path)
	switch {
	case errors.Is(err, errPDFHeavy):
		fmt.Println("heavy")
	case errors.Is(err, errPDFTooMany):
		fmt.Println("toomany")
	case err != nil:
		fmt.Println("unreadable")
	default:
		fmt.Println(formatReport(rep))
	}
	return 0
}

func formatReport(rep pdfReport) string {
	bad := "-"
	if len(rep.Bad) > 0 {
		s := make([]string, len(rep.Bad))
		for i, n := range rep.Bad {
			s[i] = strconv.Itoa(n)
		}
		bad = strings.Join(s, ",")
	}
	return fmt.Sprintf("report %d %d %s", rep.Pages, rep.ImagePages, bad)
}

func parseReport(out string) (pdfReport, error) {
	var last string
	for _, line := range strings.Split(out, "\n") {
		if l := strings.TrimSpace(line); l != "" {
			last = l
		}
	}
	f := strings.Fields(last)
	switch {
	case len(f) == 1 && f[0] == "heavy":
		return pdfReport{}, errPDFHeavy
	case len(f) == 1 && f[0] == "unreadable":
		return pdfReport{}, errPDFUnreadable
	case len(f) == 1 && f[0] == "toomany":
		return pdfReport{}, errPDFTooMany
	case len(f) != 4 || f[0] != "report":
		return pdfReport{}, fmt.Errorf("помощник ответил %q", last)
	}
	var rep pdfReport
	var err1, err2 error
	rep.Pages, err1 = strconv.Atoi(f[1])
	rep.ImagePages, err2 = strconv.Atoi(f[2])
	if err1 != nil || err2 != nil {
		return pdfReport{}, fmt.Errorf("помощник ответил %q", last)
	}
	if f[3] != "-" {
		for _, s := range strings.Split(f[3], ",") {
			n, err := strconv.Atoi(s)
			if err != nil {
				return pdfReport{}, fmt.Errorf("помощник ответил %q", last)
			}
			rep.Bad = append(rep.Bad, n)
		}
	}
	return rep, nil
}

// checkPDFInHelper разбирает файл в помощнике; слот helperSlots берёт вызывающий
func checkPDFInHelper(ctx context.Context, path string) (pdfReport, error) {
	ctx, cancel := context.WithTimeout(ctx, mergeTimeout)
	defer cancel()
	out, err := runPDFHelper(ctx, "check", path)
	if rep, perr := parseReport(out); perr == nil || errors.Is(perr, errPDFHeavy) || errors.Is(perr, errPDFUnreadable) || errors.Is(perr, errPDFTooMany) {
		return rep, perr
	}
	if err != nil {
		return pdfReport{}, err
	}
	return parseReport(out)
}

// keepsPages — сжатая копия не потеряла ни листов, ни снимков
func keepsPages(in, out pdfReport) bool {
	return out.Pages == in.Pages && out.ImagePages >= in.ImagePages && len(out.Bad) <= len(in.Bad)
}

func badPagesMessage(bad []int) string {
	if len(bad) == 1 {
		return fmt.Sprintf("Не прочитался лист %d: он пустой или снимок испорчен. Переснимите его и отправьте работу снова.", bad[0])
	}
	s := make([]string, len(bad))
	for i, n := range bad {
		s[i] = strconv.Itoa(n)
	}
	return fmt.Sprintf("Не прочитались листы %s: они пустые или снимки испорчены. Переснимите их и отправьте работу снова.", strings.Join(s, ", "))
}

// checkSubmission разбирает сохранённую сдачу до записи в базу; nil — листы целы
func Check(ctx context.Context, path string) *UploadError {
	if !acquireHelperSlot(ctx) {
		return &UploadError{http.StatusServiceUnavailable, "Сервер занят проверкой работ, попробуйте через минуту"}
	}
	defer func() { <-helperSlots }()
	rep, err := checkPDFInHelper(ctx, path)
	switch {
	case errors.Is(err, errPDFHeavy):
		rejectedSubmissions.Add(1)
		return badUpload("Файл не удалось обработать: он слишком тяжёлый или повреждён. Пересохраните или сожмите его.")
	case errors.Is(err, errPDFTooMany):
		rejectedSubmissions.Add(1)
		return badUpload("Слишком много страниц: больше %d", maxSubmitPages)
	case errors.Is(err, errPDFUnreadable):
		rejectedSubmissions.Add(1)
		return badUpload("PDF не открывается: файл повреждён или защищён паролем. Пересохраните его и попробуйте снова.")
	case err != nil:
		slog.Error("сдача: проверка PDF не выполнена", "file", path, "err", err)
		return &UploadError{http.StatusServiceUnavailable, "Не удалось проверить файл, попробуйте ещё раз"}
	case len(rep.Bad) > 0:
		rejectedSubmissions.Add(1)
		slog.Warn("сдача отклонена: листы не прочитались", "file", path, "pages", rep.Pages, "bad", rep.Bad)
		return &UploadError{http.StatusUnprocessableEntity, badPagesMessage(rep.Bad)}
	}
	return nil
}
