package pdf

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // фото из PNG приходят во FlateDecode
	"log/slog"
	"math"
	"os"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	xdraw "golang.org/x/image/draw"
)

// длинная сторона фото в сдаче: карандаш читается, вес в разы меньше
const maxScanSide = 1900

// телефон уже ужал до 2000 px, сканер даёт 1920: пережатие только портит JPEG
const shrinkSkipSide = maxScanSide * 115 / 100

const shrinkTimeout = 2 * time.Minute

// ждущая сдача памяти не держит
const shrinkQueueMax = 512

// свой слот: сжатие не задерживает приём сдач
var shrinkSlots = make(chan struct{}, 1)

// потолок сжатия меньше общего: два помощника приёма и сжатие влезают в память сервиса
var shrinkHelperMem int64 = 768 << 20

var shrinkLane = newBgLane(shrinkSlots, shrinkQueueMax)

func acquireShrinkSlot() bool { return shrinkLane.acquire(0) }

func releaseShrinkSlot() { shrinkLane.release() }

func downscaleToLongSide(src image.Image, maxSide int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide {
		return src
	}
	k := float64(maxSide) / float64(max(w, h))
	r := image.Rect(0, 0, int(math.Round(float64(w)*k)), int(math.Round(float64(h)*k)))
	var dst xdraw.Image
	if _, gray := src.(*image.Gray); gray {
		dst = image.NewGray(r)
	} else {
		dst = image.NewRGBA(r)
	}
	xdraw.CatmullRom.Scale(dst, r, src, b, xdraw.Src, nil)
	return dst
}

// shrinkPDFImages кладёт в dst копию src с уменьшенными фото; исходник не меняется.
// false — копии нет: фото и так небольшие или копия не прошла проверку листов.
func shrinkPDFImages(src, dst string) bool {
	if !acquireShrinkSlot() {
		slog.Warn("PDF: очередь сжатия полна, файл как есть", "file", src)
		return false
	}
	defer releaseShrinkSlot()

	ctx, cancel := context.WithTimeout(context.Background(), shrinkTimeout)
	defer cancel()
	out, err := runPDFHelper(ctx, "shrink", src, dst)
	switch lastWord(out) {
	case "ok":
		if err == nil {
			return true
		}
	case "rejected":
		rejectedCompressed.Add(1)
		slog.Warn("PDF: сжатая копия потеряла листы, оставлен исходник", "file", src, "report", strings.TrimSpace(out))
	}
	if err != nil {
		slog.Warn("PDF: фото не уменьшены, помощник", "file", src, "err", err)
	}
	os.Remove(dst)
	os.Remove(dst + ".tmp")
	return false
}

func lastWord(out string) string {
	f := strings.Fields(out)
	if len(f) == 0 {
		return ""
	}
	return f[len(f)-1]
}

// shrinkPDFImagesLocal работает в помощнике и печатает итог: ok, same или rejected
func shrinkPDFImagesLocal(src, dst string) {
	orig, err := os.ReadFile(src)
	if err != nil {
		fmt.Println("same")
		return
	}
	conf := model.NewDefaultConfiguration()
	ctx, err := api.ReadValidateAndOptimize(bytes.NewReader(orig), conf)
	if err != nil {
		slog.Warn("PDF: фото не уменьшить, pdfcpu не разобрал файл", "file", src, "err", err)
		fmt.Println("same")
		return
	}
	before := checkPDFContext(ctx)
	shrunk := 0
	for objNr, obj := range ctx.Optimize.ImageObjects {
		if shrinkImageObject(ctx, objNr, obj.ImageDict) {
			shrunk++
		}
	}
	if shrunk == 0 {
		fmt.Println("same")
		return
	}

	var out bytes.Buffer
	if err := api.Write(ctx, &out, conf); err != nil {
		slog.Warn("PDF: файл не собран после уменьшения фото", "file", src, "err", err)
		fmt.Println("same")
		return
	}
	if out.Len() >= len(orig) {
		fmt.Println("same")
		return
	}
	if after, ok := verifyCopy(before, out.Bytes()); !ok {
		fmt.Println("before", formatReport(before))
		fmt.Println("after", formatReport(after))
		fmt.Println("rejected")
		return
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, out.Bytes(), 0o600); err != nil {
		os.Remove(tmp)
		fmt.Println("same")
		return
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		fmt.Println("same")
		return
	}
	slog.Info("PDF: фото уменьшены", "file", src, "px", maxScanSide, "from", len(orig), "to", out.Len())
	fmt.Println("ok")
}

// verifyCopy разбирает готовую копию той же проверкой, что сдачу при приёме
func verifyCopy(before pdfReport, data []byte) (pdfReport, bool) {
	ctx, err := api.ReadValidateAndOptimize(bytes.NewReader(data), model.NewDefaultConfiguration())
	if err != nil {
		return pdfReport{}, false
	}
	after := checkPDFContext(ctx)
	return after, keepsPages(before, after)
}

func shrinkImageObject(ctx *model.Context, objNr int, sd *types.StreamDict) bool {
	w, h := sd.IntEntry("Width"), sd.IntEntry("Height")
	if w == nil || h == nil || max(*w, *h) <= shrinkSkipSide {
		return false
	}
	// маска привязана к размеру картинки
	if _, ok := sd.Find("SMask"); ok {
		return false
	}
	if _, ok := sd.Find("Mask"); ok {
		return false
	}
	if m := sd.BooleanEntry("ImageMask"); m != nil && *m {
		return false
	}

	raw, err := pdfcpu.ExtractImage(ctx, sd, false, "", objNr, false)
	if err != nil || raw == nil {
		return false
	}
	src, _, err := image.Decode(raw)
	if err != nil {
		return false
	}
	cs := "DeviceRGB"
	switch src.(type) {
	case *image.Gray:
		cs = "DeviceGray"
	case *image.YCbCr, *image.RGBA, *image.NRGBA, *image.Paletted:
	default:
		return false // CMYK и 16 бит оставляем как есть
	}

	small := downscaleToLongSide(src, maxScanSide)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, small, &jpeg.Options{Quality: 85}); err != nil {
		return false
	}
	b := small.Bounds()
	nsd, err := model.CreateDCTImageStreamDict(ctx.XRefTable, buf.Bytes(), b.Dx(), b.Dy(), 8, cs)
	if err != nil {
		return false
	}
	entry, ok := ctx.FindTableEntryLight(objNr)
	if !ok {
		return false
	}
	entry.Object = *nsd
	return true
}
