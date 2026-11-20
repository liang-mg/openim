package api

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"fmt"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/xinbo/xinbo-oa/internal/model"
)

const attendanceReportNotes = "工作日按公司或部门规则计算。已批准请假不计缺卡；已通过的补卡计入出勤；有效异常排除已忽略和自动核销的记录。"

func attendanceExportRows(r model.AttendanceReport) [][]string {
	rows := [][]string{{
		"姓名", "部门", "岗位", "应出勤(天)", "实际出勤(天)", "请假(天)", "补卡(次)", "有效异常(条)", "出勤率",
		"迟到(次)", "早退(次)", "缺卡(天)", "单卡(天)", "平均上班", "平均下班",
	}}
	appendRow := func(x model.ReportRow) {
		rows = append(rows, []string{
			x.Name, x.Department, x.Position, strconv.Itoa(x.Workdays), strconv.Itoa(x.Attend),
			strconv.Itoa(x.Leave), strconv.Itoa(x.Makeup), strconv.Itoa(x.Exceptions), fmt.Sprintf("%d%%", x.Rate),
			strconv.Itoa(x.Late), strconv.Itoa(x.Early), strconv.Itoa(x.Absent), strconv.Itoa(x.Partial), x.AvgOn, x.AvgOff,
		})
	}
	for _, row := range r.Rows {
		appendRow(row)
	}
	appendRow(r.Total)
	return rows
}

func setAttendanceDownloadHeaders(c *gin.Context, month, extension, contentType string) {
	filename := fmt.Sprintf("出勤报表_%s.%s", month, extension)
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"report_%s.%s\"; filename*=UTF-8''%s",
		month, extension, url.PathEscape(filename)))
}

func (s *Server) writeReportCSV(c *gin.Context, r model.AttendanceReport) {
	var output bytes.Buffer
	output.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&output)
	rows := attendanceExportRows(r)
	rows = append(rows, []string{"统计口径", attendanceReportNotes})
	if err := writer.WriteAll(rows); err != nil {
		fail(c, "生成报表失败")
		return
	}
	setAttendanceDownloadHeaders(c, r.Month, "csv", "text/csv; charset=utf-8")
	_, _ = c.Writer.Write(output.Bytes())
}

func (s *Server) writeReportXLSX(c *gin.Context, r model.AttendanceReport) {
	data, err := attendanceXLSX(r)
	if err != nil {
		fail(c, "生成报表失败")
		return
	}
	setAttendanceDownloadHeaders(c, r.Month, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	_, _ = c.Writer.Write(data)
}

const officeRelationshipNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const spreadsheetNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const packageRelationshipNS = "http://schemas.openxmlformats.org/package/2006/relationships"

func attendanceXLSX(r model.AttendanceReport) ([]byte, error) {
	var sheet bytes.Buffer
	sheet.WriteString(xml.Header + `<worksheet xmlns="` + spreadsheetNS + `"><sheetData>`)
	rows := attendanceExportRows(r)
	rows = append(rows, []string{"统计口径", attendanceReportNotes})
	for i, row := range rows {
		fmt.Fprintf(&sheet, `<row r="%d">`, i+1)
		for j, value := range row {
			if i > 0 && i < len(rows)-1 && ((j >= 3 && j <= 7) || (j >= 9 && j <= 12)) {
				fmt.Fprintf(&sheet, `<c><v>%s</v></c>`, value)
				continue
			}
			sheet.WriteString(`<c t="inlineStr"><is><t xml:space="preserve">`)
			if err := xml.EscapeText(&sheet, []byte(value)); err != nil {
				return nil, err
			}
			sheet.WriteString(`</t></is></c>`)
		}
		sheet.WriteString("</row>")
	}
	sheet.WriteString("</sheetData></worksheet>")

	parts := []struct{ path, content string }{
		{"[Content_Types].xml", xml.Header + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
		{"_rels/.rels", xml.Header + `<Relationships xmlns="` + packageRelationshipNS + `"><Relationship Id="rId1" Type="` + officeRelationshipNS + `/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml", xml.Header + `<workbook xmlns="` + spreadsheetNS + `" xmlns:r="` + officeRelationshipNS + `"><sheets><sheet name="出勤报表" sheetId="1" r:id="rId1"/></sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", xml.Header + `<Relationships xmlns="` + packageRelationshipNS + `"><Relationship Id="rId1" Type="` + officeRelationshipNS + `/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
		{"xl/worksheets/sheet1.xml", sheet.String()},
	}
	var output bytes.Buffer
	archive := zip.NewWriter(&output)
	for _, part := range parts {
		w, err := archive.Create(part.path)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(part.content)); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
