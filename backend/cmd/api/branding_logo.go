package main

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/url"
	"strings"
)

// Small raster uploads live with tenant branding in PostgreSQL, so deployments
// and container replacement cannot remove an uploaded company logo.
func validBrandLogo(value string) bool {
	if len(value) <= 2000 {
		if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
			return true
		}
		u, err := url.Parse(value)
		if err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil {
			return true
		}
	}
	if len(value) > 128*1024 {
		return false
	}
	for prefix, format := range map[string]string{"data:image/png;base64,": "png", "data:image/jpeg;base64,": "jpeg"} {
		if !strings.HasPrefix(value, prefix) {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
		if err != nil {
			return false
		}
		config, actual, err := image.DecodeConfig(bytes.NewReader(data))
		return err == nil && actual == format && config.Width > 0 && config.Height > 0 && config.Width <= 512 && config.Height <= 512
	}
	return false
}
