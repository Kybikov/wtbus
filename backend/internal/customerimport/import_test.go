package customerimport

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/vivat-bus/tms/internal/customerexport"
	"github.com/xuri/excelize/v2"
)

func TestReadCSVHandlesBOMAndSemicolonHeaders(t *testing.T) {
	rows, err := ReadCSV(strings.NewReader("\ufeffФИО;Номер телефона;Электронная почта;Примечание\nИрина Тест;+380671234567;irina@example.test;VIP\n"))
	if err != nil {
		t.Fatalf("ReadCSV() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("ReadCSV() rows = %d, want 1", len(rows))
	}
	row := rows[0]
	if row.FullName != "Ирина Тест" || row.Phone != "+380671234567" || row.Email != "irina@example.test" || row.Notes != "VIP" {
		t.Fatalf("ReadCSV() row = %#v", row)
	}
}

func TestReadXLSXUsesSameAliasesAndKeepsAllColumns(t *testing.T) {
	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	sheet := book.GetSheetName(0)
	if err := book.SetSheetRow(sheet, "A1", &[]any{"Клиент", "Мобильный", "Категория"}); err != nil {
		t.Fatal(err)
	}
	if err := book.SetSheetRow(sheet, "A2", &[]any{"Марко Тест", "+380501234567", "VIP"}); err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	if err := book.Write(&buffer); err != nil {
		t.Fatal(err)
	}
	rows, err := ReadXLSX(bytes.NewReader(buffer.Bytes()))
	if err != nil {
		t.Fatalf("ReadXLSX() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("ReadXLSX() rows = %d, want 1", len(rows))
	}
	if rows[0].FullName != "Марко Тест" || rows[0].Phone != "+380501234567" || rows[0].Columns["категория"] != "VIP" {
		t.Fatalf("ReadXLSX() row = %#v", rows[0])
	}
}

func TestReadXLSXAcceptsCustomerExport(t *testing.T) {
	workbook, err := customerexport.XLSX(
		[]customerexport.Field{{Key: "segment", Label: "Сегмент"}},
		[]customerexport.Record{{
			FullName:   "Марко Тест",
			Phone:      "+380501234567",
			Email:      "marko@example.test",
			TelegramID: "123456",
			Notes:      "Повторный клиент",
			CreatedAt:  time.Date(2026, time.August, 29, 8, 30, 0, 0, time.UTC),
			CustomData: map[string]any{"segment": "VIP"},
		}},
	)
	if err != nil {
		t.Fatalf("create customer export: %v", err)
	}
	rows, err := ReadXLSX(bytes.NewReader(workbook))
	if err != nil {
		t.Fatalf("ReadXLSX(export) error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("ReadXLSX(export) rows = %d, want 1", len(rows))
	}
	row := rows[0]
	if row.FullName != "Марко Тест" || row.Phone != "+380501234567" || row.Email != "marko@example.test" || row.TelegramID != "123456" || row.Notes != "Повторный клиент" || row.Columns["сегмент"] != "VIP" {
		t.Fatalf("ReadXLSX(export) row = %#v", row)
	}
}
