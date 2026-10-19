package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestBrandLogoUploadValidation(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	data := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	for _, value := range []string{data, "https://example.com/logo.png", "/brand/vivat-bus.png"} {
		if !validBrandLogo(value) {
			t.Fatalf("valid logo rejected: %.40s", value)
		}
	}
	for _, value := range []string{"//example.com/logo.png", "http://example.com/logo.png", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,bad!", strings.Replace(data, "image/png", "image/jpeg", 1), "data:image/png;base64," + strings.Repeat("A", 128*1024)} {
		if validBrandLogo(value) {
			t.Fatalf("invalid logo accepted: %.40s", value)
		}
	}
	buf.Reset()
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 513, 1))); err != nil {
		t.Fatal(err)
	}
	if validBrandLogo("data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())) {
		t.Fatal("oversized dimensions accepted")
	}
}
