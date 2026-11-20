package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
)

const CtxUserID = "oa_user_id"

// claims 与 chat 服务 pkg/common/tokenverify 的 claims 结构保持一致。
// 关键：字段名必须相同（UserID），否则 JWT 反序列化取不到值。
type claims struct {
	UserID     string
	UserType   int32
	PlatformID int32
	jwt.RegisteredClaims
}

// Parse 用与 chat 相同的 OPENIM_SECRET 校验 chatToken，取出登录人 userID。
// OA 不另发登录态，复用 IM 的 token，避免两套账号。
func Parse(tokenStr, secret string) (string, error) {
	if tokenStr == "" {
		return "", errors.New("empty token")
	}
	c := &claims{}
	tk, err := jwt.ParseWithClaims(tokenStr, c, func(t *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return "", err
	}
	if !tk.Valid || c.UserID == "" {
		return "", errors.New("invalid token")
	}
	return c.UserID, nil
}

// Middleware 从请求头 token（或 Authorization: Bearer）解析登录人并注入 context。
// 前端 request.ts 用的是 header token，这里以它为主。
func Middleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tok := c.GetHeader("token")
		if tok == "" {
			tok = strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		}
		userID, err := Parse(tok, secret)
		if err != nil {
			c.AbortWithStatusJSON(200, gin.H{"code": 401, "msg": "登录已失效，请重新登录"})
			return
		}
		c.Set(CtxUserID, userID)
		c.Next()
	}
}

// MiddlewareWithCheck 在解析 token 之后多查一次账号状态。
// disabled 只在 OA 员工档案里明确标记停用的人返回 true：不在档案里的纯 IM 用户
// （例如还没分配组织关系的账号）不受影响，避免把聊天功能一起锁死。
func MiddlewareWithCheck(secret string, disabled func(context.Context, string) bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		tok := c.GetHeader("token")
		if tok == "" {
			tok = strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		}
		userID, err := Parse(tok, secret)
		if err != nil {
			c.AbortWithStatusJSON(200, gin.H{"code": 401, "msg": "登录已失效，请重新登录"})
			return
		}
		if disabled != nil && disabled(c.Request.Context(), userID) {
			c.AbortWithStatusJSON(200, gin.H{"code": 403, "msg": "账号已停用，请联系管理员"})
			return
		}
		c.Set(CtxUserID, userID)
		c.Next()
	}
}

func UserID(c *gin.Context) string {
	v, ok := c.Get(CtxUserID)
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}
