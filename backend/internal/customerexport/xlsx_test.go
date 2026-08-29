package customerexport

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestXLSXIncludesSystemAndCustomFields(t *testing.T) {
	data, err := XLSX(
		[]Field{{Key: "segment", Label: "Сегмент"}},
		[]Record{{
			FullName:   "Ирина Тест",
			Phone:      "+380671234567",
			CreatedAt:  time.Date(2026, 8, 29, 8, 30, 0, 0, time.UTC),
			CustomData: map[string]any{"segment": "VIP", "source": "Router"},
		}},
	)
	if err != nil {
		t.Fatalf("XLSX() error = %v", err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("open export: %v", err)
	}
	defer func() { _ = book.Close() }()
	rows, err := book.GetRows("Клиенты")
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0][0] != "ФИО" || rows[0][6] != "Сегмент" || rows[0][7] != "source" {
		t.Fatalf("headers = %#v", rows[0])
	}
	if rows[1][0] != "Ирина Тест" || rows[1][6] != "VIP" || rows[1][7] != "Router" {
		t.Fatalf("record = %#v", rows[1])
	}
}
