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

// ColumnTarget is also used by the preview so ignored columns are visible.
func ColumnTarget(header string) string {
	key := normalize(header)
	for label, aliases := range map[string][]string{
		"Имя":         {"имя", "фио", "name", "full_name", "клиент", "customer", "ім’я", "ім'я", "піб"},
		"Телефон":     {"телефон", "номер телефона", "мобильный", "phone", "phone_e164", "mobile", "telephone", "phone number"},
		"Email":       {"email", "e-mail", "электронная почта", "електронна пошта"},
		"Telegram ID": {"telegram", "telegram_id", "telegram id", "телеграм", "тг"},
		"Комментарий": {"комментарий", "комментарии", "примечание", "заметка", "заметки", "notes", "note", "коментар", "примітка"},
	} {
		for _, alias := range aliases {
			if key == alias {
				return label
			}
		}
	}
	return ""
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
		if len(records) > 5000 {
			return nil, fmt.Errorf("Импорт ограничен 5000 строками")
		}
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
		key := normalize(header)
		if key == "" {
			continue
		}
		if _, exists := index[key]; exists {
			return nil, fmt.Errorf("Повторяется заголовок колонки: %s", header)
		}
		index[key] = i
	}
	phoneIndex, ok := firstIndex(index, "телефон", "номер телефона", "мобильный", "phone", "phone_e164", "mobile", "telephone", "phone number")
	if !ok {
		return nil, fmt.Errorf("В таблице нужна колонка «Телефон»")
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
		phone := ""
		if phoneIndex < len(record) {
			phone = strings.TrimSpace(record[phoneIndex])
		}
		row := Row{FullName: value("имя", "фио", "name", "full_name", "клиент", "customer", "ім’я", "ім'я", "піб"), Phone: phone, Email: value("email", "e-mail", "электронная почта", "електронна пошта"), TelegramID: value("telegram", "telegram_id", "telegram id", "телеграм", "тг"), Notes: value("комментарий", "комментарии", "примечание", "заметка", "заметки", "notes", "note", "коментар", "примітка"), Columns: columns, Number: number}
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
