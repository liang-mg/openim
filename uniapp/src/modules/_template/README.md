# 业务模块骨架（复制即用）

```bash
cp -r src/modules/_template src/modules/<domain>
```

一个模块分四层，**页面只做装配，规则写在 definition，数据走 api**：

```
modules/<domain>/
├── definition.js     # 字段、状态、动作、校验：只声明，不执行
├── api/index.js      # 调 src/api/oa.js 里的函数（必须与 PC 端同名同参）
├── mock/index.js     # 内存假数据，只给独立测试用，不进页面运行链路
└── pages/
    ├── list.vue      # 列表：筛选 + 分页
    └── detail.vue    # 详情：只读展示 + 动作入口
```

接进来的步骤：

1. `definition.js` 填字段/状态/动作；
2. `api/index.js` 从 `@/api/oa` 引入接口（没有就先在 `api/oa.js` 加，且必须对应
   `frontend/src/api/oaApi.ts` 里的同名函数，否则 `npm run guard:contract` 会失败）；
3. `pages/*.vue` 复制后改字段引用；
4. `src/pages.json` 注册页面；
5. `npm run guard` + 在 `.local/tools/regression-all.js` 加一条断言。

**不要**在页面里写状态机分支、不要在页面里直接 `uni.request`、不要用 `height:100vh`。
