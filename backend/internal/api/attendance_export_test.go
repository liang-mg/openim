package api

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/xinbo/xinbo-oa/internal/model"
)

func TestAttendanceXLSXContainsReportCounts(t *testing.T) {
	result := model.AttendanceReport{
		Rows:  []model.ReportRow{{Name: "张三 & 小组", Attend: 8, Leave: 2, Makeup: 3, Exceptions: 4}},
		Total: model.ReportRow{Name: "合计", Attend: 8, Leave: 2, Makeup: 3, Exceptions: 4},
	}
	data, err := attendanceXLSX(result)
	if err != nil {
		t.Fatal(err)
	}
	book, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	sheet, err := book.Open("xl/worksheets/sheet1.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer sheet.Close()
	content, err := io.ReadAll(sheet)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"请假(天)", "补卡(次)", "有效异常(条)", "张三 &amp; 小组", "合计", "<v>8</v>", "<v>2</v>", "<v>3</v>", "<v>4</v>"} {
		if !strings.Contains(string(content), want) {
			t.Errorf("missing %q in sheet", want)
		}
	}
}
