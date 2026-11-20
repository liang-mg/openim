package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 文件服务：
//   上传 POST /files/upload（multipart）
//   下载 GET  /files/:id            —— 支持 header token，或 ?e=&s= 短签名
//   取链接 GET /files/:id/link      —— 给前端换一个 30 分钟有效的签名地址
//
// 为什么不用公开链接：日报附件里可能是客户名单、报价、身份证照片，
// 一旦生成永久可访问地址，链接被转发就等于数据泄露。签名地址只活 30 分钟。

const (
	fileLinkTTL       = 30 * time.Minute
	maxFileNameLn     = 120
	fileScopeLeave    = "leave"
	fileScopeContract = "contract"
)

func fileScopeRequiresRecord(scope string) bool {
	return scope == fileScopeLeave || scope == fileScopeContract
}

// 允许的扩展名白名单：不靠 Content-Type 判断（客户端可伪造）
var allowedFileExt = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".webp": "image/webp",
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".txt":  "text/plain",
	".zip":  "application/zip",
}

func newFileID() string {
	return fmt.Sprintf("f_%d_%s", time.Now().UnixNano(), randHex(4))
}

func randHex(n int) string {
	b := make([]byte, n)
	seed := time.Now().UnixNano()
	for i := range b {
		seed = seed*6364136223846793005 + 1442695040888963407
		b[i] = byte(seed >> 33)
	}
	return hex.EncodeToString(b)
}

// safeName 只保留文件名本身，去掉路径与控制字符
func safeName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if len(name) > maxFileNameLn {
		ext := path.Ext(name)
		name = name[:maxFileNameLn-len(ext)] + ext
	}
	if name == "" || name == "." || name == "/" {
		name = "unnamed"
	}
	return name
}

// saveFile 统一入口：上传成功后落元数据，返回可下发的 FileMeta
func (s *Server) saveFile(ctx context.Context, ownerID, name, scope string, r io.Reader, size int64, mime string, contractEmployeeID ...string) (*model.FileMeta, error) {
	fid := newFileID()
	ext := strings.ToLower(path.Ext(name))
	key := fmt.Sprintf("%s/%s/%s%s", s.Cfg.CompanyID, time.Now().Format("2006-01"), fid, ext)
	if err := s.Files.Put(ctx, key, r, size, mime); err != nil {
		return nil, err
	}
	meta := model.FileMeta{
		ID:        fid,
		CompanyID: s.Cfg.CompanyID,
		OwnerID:   ownerID,
		Name:      name,
		Size:      size,
		Mime:      mime,
		ObjectKey: key,
		Scope:     scope,
		CreatedAt: time.Now().UnixMilli(),
	}
	if len(contractEmployeeID) > 0 {
		meta.ContractEmployeeID = contractEmployeeID[0]
	}
	if _, err := s.Store.Files().InsertOne(ctx, meta); err != nil {
		// 入库失败就把对象删掉，避免留下没有任何记录指向的垃圾文件
		_ = s.Files.Remove(ctx, key)
		return nil, err
	}
	return &meta, nil
}

// Upload 上传日报、请假等业务的附件。
func (s *Server) Upload(c *gin.Context) {
	if s.Files == nil {
		fail(c, "文件服务未就绪，请联系管理员")
		return
	}
	uid := auth.UserID(c)
	maxBytes := s.Cfg.FileMaxMB * 1024 * 1024
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)

	fh, err := c.FormFile("file")
	if err != nil {
		fail(c, fmt.Sprintf("文件为空或超过 %dMB", s.Cfg.FileMaxMB))
		return
	}
	if fh.Size <= 0 || fh.Size > maxBytes {
		fail(c, fmt.Sprintf("文件大小需在 1B–%dMB 之间", s.Cfg.FileMaxMB))
		return
	}

	name := safeName(fh.Filename)
	ext := strings.ToLower(path.Ext(name))
	mime, allowed := allowedFileExt[ext]
	if !allowed {
		fail(c, "不支持的文件类型")
		return
	}

	scope := c.PostForm("scope")
	if scope == "" {
		scope = "report"
	}

	f, err := fh.Open()
	if err != nil {
		fail(c, "读取文件失败")
		return
	}
	defer f.Close()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	employeeID := ""
	if scope == fileScopeContract {
		if !s.isAdmin(ctx, uid) {
			failCode(c, 403, "无权上传合同附件")
			return
		}
		employeeID = c.PostForm("contract_employee_id")
		if employeeID == "" || s.getEmployee(ctx, employeeID) == nil {
			fail(c, "员工不存在")
			return
		}
	}
	meta, err := s.saveFile(ctx, uid, name, scope, f, fh.Size, mime, employeeID)
	if err != nil {
		fail(c, "上传失败，请重试")
		return
	}

	result := gin.H{
		"file_id": meta.ID,
		"name":    meta.Name,
		"size":    meta.Size,
		"mime":    meta.Mime,
		"url":     "/oa/api/v1/files/" + meta.ID,
	}
	if !fileScopeRequiresRecord(meta.Scope) {
		result["signed_url"] = s.signedPath(meta.ID, uid, time.Now().Add(fileLinkTTL))
	}
	ok(c, result)
}

// FileLink 为支持短签名的文件生成链接。
func (s *Server) FileLink(c *gin.Context) {
	if s.Files == nil {
		fail(c, "文件服务未就绪")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	meta := s.loadFile(ctx, c.Param("id"))
	if meta == nil {
		fail(c, "文件不存在")
		return
	}
	if fileScopeRequiresRecord(meta.Scope) || !s.canReadFile(ctx, uid, meta) {
		fail(c, "无权访问该文件")
		return
	}
	ok(c, gin.H{
		"file_id":    meta.ID,
		"name":       meta.Name,
		"size":       meta.Size,
		"mime":       meta.Mime,
		"signed_url": s.signedPath(meta.ID, uid, time.Now().Add(fileLinkTTL)),
		"expires_in": int(fileLinkTTL.Seconds()),
	})
}

// Download 校验登录态或短签名。请假附件还需校验关联申请。
func (s *Server) Download(c *gin.Context) {
	if s.Files == nil {
		c.Status(503)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	id := c.Param("id")
	meta := s.loadFile(ctx, id)
	if meta == nil {
		c.Status(404)
		return
	}

	requiresRecord := fileScopeRequiresRecord(meta.Scope)
	// 签名供日报、打卡等页面直接使用；请假与合同附件仍需关联记录。
	sigOK := false
	if e := c.Query("e"); !requiresRecord && e != "" {
		sigOK = s.verifySignature(id, c.Query("u"), e, c.Query("s"), time.Now())
	}
	if !sigOK {
		tok := c.GetHeader("token")
		if tok == "" {
			tok = strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		}
		uid, err := auth.Parse(tok, s.Cfg.Secret)
		if err != nil {
			c.Status(403)
			return
		}
		canRead := false
		switch meta.Scope {
		case fileScopeLeave:
			canRead = s.canReadLeaveAttachment(ctx, uid, c.Query("leave_id"), meta)
		case fileScopeContract:
			canRead = s.canReadContractAttachment(ctx, uid, c.Query("contract_employee_id"), meta)
		default:
			canRead = s.canReadFile(ctx, uid, meta)
		}
		if !canRead {
			c.Status(403)
			return
		}
	}

	obj, err := s.Files.Get(ctx, meta.ObjectKey)
	if err != nil {
		c.Status(502)
		return
	}
	defer obj.Close()

	// 文件名按 RFC 5987 编码，中文名不会变成乱码或被截断
	disposition := "attachment"
	if strings.HasPrefix(meta.Mime, "image/") {
		disposition = "inline"
	}
	c.Header("Content-Type", meta.Mime)
	c.Header("Content-Length", strconv.FormatInt(meta.Size, 10))
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disposition, url.PathEscape(meta.Name)))
	if requiresRecord {
		c.Header("Cache-Control", "private, no-store")
	} else {
		c.Header("Cache-Control", "private, max-age=600")
	}
	if _, err = io.Copy(c.Writer, obj); err != nil {
		// 头已经写出去了，只能中断连接
		return
	}
}

func (s *Server) loadFile(ctx context.Context, id string) *model.FileMeta {
	if id == "" {
		return nil
	}
	var meta model.FileMeta
	err := s.Store.Files().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"file_id":    id,
	}).Decode(&meta)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil
		}
		return nil
	}
	return &meta
}

// canReadFile 谁能看这个文件：
//  1. 上传者本人
//  2. 他的直属组长 / 团队领导（按汇报链，和日报权限一致）
//  3. 管理员（HR 需要核对材料）
//
// 打卡照片同样套这个规则：组长看得到组员的打卡照片，才谈得上"防代打"。
func (s *Server) canReadFile(ctx context.Context, uid string, meta *model.FileMeta) bool {
	if meta.CompanyID != s.Cfg.CompanyID {
		return false
	}
	if meta.OwnerID == uid {
		return true
	}
	if s.isAdmin(ctx, uid) {
		return true
	}
	for _, id := range s.teamIDs(ctx, uid) {
		if id == meta.OwnerID {
			return true
		}
	}
	return false
}

// ---------- 短签名 ----------

// sigPayload 把 fileID、使用者、过期时间绑在一起，
// 别人拿到链接改不了 id，也没法延长时间。
func sigPayload(fileID, uid string, exp int64) string {
	return fmt.Sprintf("%s|%s|%d", fileID, uid, exp)
}

func (s *Server) sign(fileID, uid string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(s.Cfg.Secret))
	mac.Write([]byte(sigPayload(fileID, uid, exp)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) signedPath(fileID, uid string, until time.Time) string {
	exp := until.Unix()
	return fmt.Sprintf("/oa/api/v1/files/%s?u=%s&e=%d&s=%s",
		fileID, url.QueryEscape(uid), exp, s.sign(fileID, uid, exp))
}

func (s *Server) verifySignature(fileID, uid, expStr, sig string, now time.Time) bool {
	if uid == "" || expStr == "" || sig == "" {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || now.Unix() > exp {
		return false
	}
	want := s.sign(fileID, uid, exp)
	return hmac.Equal([]byte(want), []byte(sig))
}

// dataURLToReader 把拍照得到的 base64 图片转成可上传的流。
// 打卡照片在浏览器里已经画了水印，这里只做解码与入库。
func dataURLToReader(dataURL string) (io.Reader, int64, string, string, bool) {
	const prefix = "data:"
	if !strings.HasPrefix(dataURL, prefix) {
		return nil, 0, "", "", false
	}
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return nil, 0, "", "", false
	}
	header := dataURL[len(prefix):comma] // image/jpeg;base64
	if !strings.Contains(header, "base64") {
		return nil, 0, "", "", false
	}
	mime := strings.TrimSuffix(header, ";base64")
	ext := ".jpg"
	switch mime {
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	}
	decoded, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil || len(decoded) == 0 {
		return nil, 0, "", "", false
	}
	return bytes.NewReader(decoded), int64(len(decoded)), mime, ext, true
}
