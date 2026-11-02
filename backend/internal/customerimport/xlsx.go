package customerimport

import (
	"fmt"
	"io"

	"github.com/xuri/excelize/v2"
)

// ReadXLSX reads the first worksheet. Its columns follow the same aliases as CSV.
func ReadXLSX(reader io.Reader) ([]Row, error) {
	book, err := excelize.OpenReader(reader, excelize.Options{UnzipSizeLimit: 32 << 20, UnzipXMLSizeLimit: 16 << 20})
	if err != nil {
		return nil, fmt.Errorf("open XLSX: %w", err)
	}
	defer func() { _ = book.Close() }()
	sheets := book.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("XLSX has no worksheets")
	}
	records, err := book.GetRows(sheets[0])
	if err != nil {
		return nil, fmt.Errorf("read worksheet: %w", err)
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("XLSX is empty")
	}
	if len(records) > 5001 {
		return nil, fmt.Errorf("Импорт ограничен 5000 строками")
	}
	return rowsFromRecords(records[0], records[1:])
}
