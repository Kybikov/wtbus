package customerimport

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"strings"
)

type Row struct {
	FullName, Phone, Email, TelegramID, Notes string
	Columns                                   map[string]string
	Number                                    int
}

// ReadCSV accepts Russian and English column headers. Persistence and phone
// validation remain in the API layer so import and manual creation share rules.
func ReadCSV(reader io.Reader) ([]Row, error) {
	contents, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read CSV: %w", err)
	}
	csvReader := csv.NewReader(bytes.NewReader(contents))
	csvReader.TrimLeadingSpace = true
	csvReader.FieldsPerRecord = -1
	csvReader.Comma = detectDelimiter(contents)
	headers, err := csvReader.Read()
	if err != nil {
		return nil, fmt.Errorf("read headers: %w", err)
	}
	records := make([][]string, 0)
	for {
		record, readErr := csvReader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, fmt.Errorf("read row %d: %w", len(records)+2, readErr)
		}
		records = append(records, record)
	}
	return rowsFromRecords(headers, records)
}

func detectDelimiter(contents []byte) rune {
	firstLine := strings.SplitN(string(contents), "\n", 2)[0]
	counts := map[rune]int{',': 0, ';': 0, '\t': 0}
	for _, character := range firstLine {
		if _, exists := counts[character]; exists {
			counts[character]++
		}
	}
	delimiter := ','
	for _, candidate := range []rune{';', '\t', ','} {
		if counts[candidate] > counts[delimiter] {
			delimiter = candidate
		}
	}
	return delimiter
}

func rowsFromRecords(headers []string, records [][]string) ([]Row, error) {
	index := map[string]int{}
	for i, header := range headers {
		index[normalize(header)] = i
	}
	phoneIndex, ok := firstIndex(index, "телефон", "номер телефона", "мобильный", "phone", "phone_e164", "mobile", "telephone", "phone number")
	if !ok {
		return nil, fmt.Errorf("CSV must contain a phone column")
	}
	rows := []Row{}
	for recordIndex, record := range records {
		number := recordIndex + 2
		value := func(keys ...string) string {
			if i, ok := firstIndex(index, keys...); ok && i < len(record) {
				return strings.TrimSpace(record[i])
			}
			return ""
		}
		columns := make(map[string]string, len(index))
		for key, index := range index {
			if index < len(record) {
				columns[key] = strings.TrimSpace(record[index])
			}
		}
		row := Row{FullName: value("имя", "фио", "name", "full_name", "клиент", "customer"), Phone: strings.TrimSpace(record[phoneIndex]), Email: value("email", "e-mail", "электронная почта"), TelegramID: value("telegram", "telegram_id", "telegram id", "телеграм", "тг"), Notes: value("комментарий", "комментарии", "примечание", "заметка", "заметки", "notes", "note"), Columns: columns, Number: number}
		if row.FullName == "" && row.Phone == "" && row.Email == "" {
			continue
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func normalize(value string) string {
	value = strings.TrimPrefix(value, "\ufeff")
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.Join(strings.Fields(value), " ")
}
func firstIndex(index map[string]int, keys ...string) (int, bool) {
	for _, key := range keys {
		if value, ok := index[key]; ok {
			return value, true
		}
	}
	return 0, false
}
