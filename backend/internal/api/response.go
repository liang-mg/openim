package api

import "github.com/gin-gonic/gin"

// 统一响应：成功 code=0，失败 code!=0，前端统一拦截。
func ok(c *gin.Context, data any) {
	c.JSON(200, gin.H{"code": 0, "msg": "ok", "data": data})
}

func fail(c *gin.Context, msg string) {
	c.JSON(200, gin.H{"code": 1, "msg": msg})
}

func failCode(c *gin.Context, code int, msg string) {
	c.JSON(200, gin.H{"code": code, "msg": msg})
}
