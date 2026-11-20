package api

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"

	"github.com/xinbo/xinbo-oa/internal/model"
)

// 数据范围（Data Scope）—— 决定"我能看到谁的数据"。
//
// 这里只有一份实现：日报、考勤、工作台待办、以后的审批中心都用它。
// 之前各模块自己写 "role == manager" 这种判断，结果同一个人日报能审、
// 考勤却只看得到自己（H6），组长自己的日报反而没人审（H9）。
//
// 铁律：范围由服务端按组织关系算，前端传的 scope 只作为"想要的视角"，
// 超出权限一律 403，绝不退化成空列表（空列表会让调用方以为"真没人"）。
const (
	ScopeMine = "mine" // 只看自己
	ScopeTeam = "team" // 汇报链上的全部下属（递归，不含自己）
	ScopeAll  = "all"  // 全公司（HR / 管理员）
)

// visibleUserIDs 统一的数据范围计算。
// scope=team 时沿 manager_id 递归全部下属，带 visited 防环（脏数据成环不会死循环），
// 停用（离职）的人不计入——他们已经不参与汇报链，但历史数据仍然保留。
func (s *Server) visibleUserIDs(ctx context.Context, uid, scope string) []string {
	switch scope {
	case ScopeAll:
		cur, err := s.Store.Employees().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID,
			"disabled":   bson.M{"$ne": true},
		})
		if err != nil {
			return nil
		}
		var list []model.Employee
		if err = cur.All(ctx, &list); err != nil {
			return nil
		}
		ids := make([]string, 0, len(list))
		for _, e := range list {
			ids = append(ids, e.UserID)
		}
		return ids

	case ScopeTeam:
		// 一次性把公司通讯录拉进内存再沿 manager_id 展开：
		// 一次查询胜过多层递归查询，几十上百人也只查一次库。
		cur, err := s.Store.Employees().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID,
			"disabled":   bson.M{"$ne": true},
		})
		if err != nil {
			return nil
		}
		var list []model.Employee
		if err = cur.All(ctx, &list); err != nil {
			return nil
		}
		children := make(map[string][]string, len(list))
		for _, e := range list {
			if e.ManagerID == "" {
				continue
			}
			children[e.ManagerID] = append(children[e.ManagerID], e.UserID)
		}

		var out []string
		visited := map[string]bool{uid: true} // 自己放进去，顺手挡住自己汇报给自己的脏数据
		queue := append([]string{}, children[uid]...)
		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]
			if visited[cur] {
				continue
			}
			visited[cur] = true
			out = append(out, cur)
			queue = append(queue, children[cur]...)
		}
		return out
	}

	return []string{uid}
}

// canUseScope 当前用户能不能用这个视角。范围对不对是"关系"问题，不是"角色"问题：
// 名下有下属就能看团队，哪怕角色还是 employee（组织结构没同步角色时也不至于看不见人）。
func (s *Server) canUseScope(ctx context.Context, uid, scope string) bool {
	switch scope {
	case ScopeMine:
		return true
	case ScopeAll:
		return s.isAdmin(ctx, uid)
	case ScopeTeam:
		if s.isAdmin(ctx, uid) {
			return true
		}
		switch s.roleOf(ctx, uid) {
		case "manager", "leader", "hr":
			return true
		}
		return len(s.subordinateIDs(ctx, uid)) > 0
	}
	return false
}

// resolveScope 把请求里的 scope 收敛到一个"当前用户真的能用"的值。
// 不传时按角色给默认：有下属默认团队，否则看自己。
func (s *Server) resolveScope(ctx context.Context, uid, want string) (string, bool) {
	if want == "" {
		if s.canUseScope(ctx, uid, ScopeTeam) && len(s.subordinateIDs(ctx, uid)) > 0 {
			return ScopeTeam, true
		}
		return ScopeMine, true
	}
	if want != ScopeMine && want != ScopeTeam && want != ScopeAll {
		return "", false
	}
	if !s.canUseScope(ctx, uid, want) {
		return "", false
	}
	return want, true
}
