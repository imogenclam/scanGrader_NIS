package pdf

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func photo(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: uint8(x ^ y), A: 255})
		}
	}
	return img
}

func TestDownscaleToLongSide(t *testing.T) {
	got := downscaleToLongSide(photo(4000, 3000), maxScanSide).Bounds()
	if got.Dx() != 1900 || got.Dy() != 1425 {
		t.Fatalf("4000×3000 → %d×%d, ждали 1900×1425", got.Dx(), got.Dy())
	}
	small := photo(1200, 1600)
	if downscaleToLongSide(small, maxScanSide) != small {
		t.Fatal("маленькое фото увеличивать или пересобирать незачем")
	}
}

func TestShrinkPDFImages_PhoneSizedPhotoUntouched(t *testing.T) {
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, photo(2000, 1500), &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "phone.pdf")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := api.ImportImages(nil, f, []io.Reader{&jpg}, nil, nil); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if shrinkPDFImages(path, path+".min") {
		t.Fatal("фото 2000 px, уже ужатое телефоном, пережимать не надо")
	}
	if _, err := os.Stat(path + ".min"); err == nil {
		t.Fatal("копия создана")
	}
}

func TestShrinkPDFImages_PhotoInsidePDF(t *testing.T) {
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, photo(4000, 3000), &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "scan.pdf")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := api.ImportImages(nil, f, []io.Reader{&jpg}, nil, nil); err != nil {
		t.Fatal(err)
	}
	f.Close()

	if !shrinkPDFImages(path, path+".min") {
		t.Fatal("крупное фото не уменьшено")
	}

	f, err = os.Open(path + ".min")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	pages, err := api.Images(f, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 1 || len(pages[0]) != 1 {
		t.Fatalf("ждали одну картинку на одной странице: %v", pages)
	}
	for _, img := range pages[0] {
		if img.Width != 1900 || img.Height != 1425 {
			t.Fatalf("фото в PDF %d×%d, ждали 1900×1425", img.Width, img.Height)
		}
	}
	if n, err := api.PageCountFile(path + ".min"); err != nil || n != 1 {
		t.Fatalf("PDF после сжатия не читается: %d %v", n, err)
	}
}
