// Package customerexport creates portable exports of a tenant's customer base.
package customerexport

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// Field describes a tenant-defined customer field.
type Field struct {
	Key   string
	Label string
}

// Record is the customer data that can be safely represented in a spreadsheet.
type Record struct {
	FullName   string
	Phone      string
	Email      string
	TelegramID string
	Notes      string
	CreatedAt  time.Time
	CustomData map[string]any
}

// XLSX returns a single-sheet workbook with all records and tenant-defined fields.
// Unknown fields are retained as well, so an export never silently drops imported data.
func XLSX(fields []Field, records []Record) ([]byte, error) {
	orderedFields := append([]Field(nil), fields...)
	knownFields := make(map[string]struct{}, len(orderedFields))
	for _, field := range orderedFields {
		knownFields[field.Key] = struct{}{}
	}
	extraKeys := make(map[string]struct{})
	for _, record := range records {
		for key := range record.CustomData {
			if _, known := knownFields[key]; !known {
				extraKeys[key] = struct{}{}
			}
		}
	}
	extras := make([]string, 0, len(extraKeys))
	for key := range extraKeys {
		extras = append(extras, key)
	}
	sort.Strings(extras)
	for _, key := range extras {
		orderedFields = append(orderedFields, Field{Key: key, Label: key})
	}

	headers := []any{"ФИО", "Телефон", "Email", "Telegram ID", "Заметки", "Создан"}
	for _, field := range orderedFields {
		label := strings.TrimSpace(field.Label)
		if label == "" {
			label = field.Key
		}
		headers = append(headers, label)
	}

	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	sheet := book.GetSheetName(0)
	if err := book.SetSheetName(sheet, "Клиенты"); err != nil {
		return nil, fmt.Errorf("rename worksheet: %w", err)
	}
	sheet = "Клиенты"
	if err := book.SetSheetRow(sheet, "A1", &headers); err != nil {
		return nil, fmt.Errorf("write headers: %w", err)
	}
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"8A6500"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center"},
	})
	if err != nil {
		return nil, fmt.Errorf("create header style: %w", err)
	}
	lastColumn, err := excelize.ColumnNumberToName(len(headers))
	if err != nil {
		return nil, fmt.Errorf("resolve last column: %w", err)
	}
	if err := book.SetCellStyle(sheet, "A1", lastColumn+"1", headerStyle); err != nil {
		return nil, fmt.Errorf("style headers: %w", err)
	}
	if err := book.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return nil, fmt.Errorf("freeze header: %w", err)
	}

	for index, record := range records {
		row := []any{
			record.FullName,
			record.Phone,
			record.Email,
			record.TelegramID,
			record.Notes,
			record.CreatedAt.In(time.UTC).Format("2006-01-02 15:04 UTC"),
		}
		for _, field := range orderedFields {
			row = append(row, valueForCell(record.CustomData[field.Key]))
		}
		cell, cellErr := excelize.CoordinatesToCellName(1, index+2)
		if cellErr != nil {
			return nil, fmt.Errorf("resolve row %d: %w", index+2, cellErr)
		}
		if err := book.SetSheetRow(sheet, cell, &row); err != nil {
			return nil, fmt.Errorf("write row %d: %w", index+2, err)
		}
	}

	if err := book.SetColWidth(sheet, "A", "A", 28); err != nil {
		return nil, fmt.Errorf("set name width: %w", err)
	}
	if err := book.SetColWidth(sheet, "B", "B", 20); err != nil {
		return nil, fmt.Errorf("set phone width: %w", err)
	}
	if err := book.SetColWidth(sheet, "C", lastColumn, 24); err != nil {
		return nil, fmt.Errorf("set column widths: %w", err)
	}
	lastRow := len(records) + 1
	if err := book.AutoFilter(sheet, fmt.Sprintf("A1:%s%d", lastColumn, lastRow), nil); err != nil {
		return nil, fmt.Errorf("add filter: %w", err)
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buffer.Bytes(), nil
}

func valueForCell(value any) any {
	switch typed := value.(type) {
	case nil:
		return ""
	case string, float64, bool:
		return typed
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Sprint(typed)
		}
		return string(encoded)
	}
}
