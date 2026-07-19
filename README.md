# LingGlow / 灵妆

灵妆是面向 Codex/GPT、WorkBuddy 与豆包的 macOS 主题管理工具。

本仓库只发布：

- Apple Developer ID 签名并公证的 macOS DMG
- 4 套可公开分发的免费 Theme Pack 与素材来源说明
- 可复用的三客户端皮肤制作 Skill
- 客户端自动升级清单 `latest.json`

本仓库**不包含灵妆应用源码**。GitHub 自动生成的 Source code 压缩包只包含文档、模板、Skill 与升级清单。

## v2.1.0

- 菜单栏图标打开持久桌面窗口，窗口不会因点击其他应用而消失，且不显示在 Dock。
- 新增“检查更新”和用户可选的“自动安装更新”。升级前校验 SHA-256、Bundle ID、Team ID、Developer ID 签名与 Apple 公证状态。
- 内置 7 套模板，全部声明 Codex/GPT、WorkBuddy、豆包三客户端投影。
- Codex 模板使用两张不同图片：一张全局背景，一张相关联的 3:1 新建任务图。
- WorkBuddy 每套模板使用风格匹配的替换图；足球主题使用对应色系足球，其他主题使用匹配的猫、狐狸、光球或精灵。
- 4 套免费模板：`aurora-free`、`amber-free`、`dream-gothic-void`、`dream-portal-free`。
- 3 套 VIP 模板：`cr7-portugal`、`messi-argentina`、`neymar-brazil`。

前往 [Releases](https://github.com/AI-Scarlett/LingGlow/releases/latest) 下载 DMG。

## 免费模板

模板与预览位于 [`templates/free`](templates/free)。可明确重分发的 Gothic Void 和 Portal 方向已纳入；上游 Arina 人物素材因 NOTICE 明确排除 MIT 授权而未收录。

## Skin Skill

[`skills/skin-abstract`](skills/skin-abstract) 包含：

- 显式浅色/深色模式契约
- 单一全局背景与客户端首页专图分层
- Codex/GPT、WorkBuddy、豆包适配规则
- 弹窗、卡片、输入框与文字对比度策略
- WorkBuddy 主题匹配替换图与真实 Alpha 检测
- 点击遮挡防护和真实客户端截图验收矩阵
- 所有配图的建议比例、尺寸与大小上限
- 素材来源和再分发权利检查

## 图片规范

| 用途 | 建议尺寸 | 比例 | 大小限制 |
| --- | ---: | ---: | ---: |
| 全局背景 | 2560x1600 | 16:10 | 4 MB，最长边 4096 px，最多 16 MP |
| Codex 首页图 | 2400x800 | 3:1 | 4 MB |
| WorkBuddy 首页图 | 1920x1080 | 16:9 | 4 MB |
| App Icon | 1024x1024 | 1:1 | 2 MB，最长边 2048 px |
| WorkBuddy 替换图 | 1024x1024 | 1:1 | 2 MB，透明时必须有真实 Alpha |

## 签名与公证

DMG 和应用均使用 Developer ID Application 签名，Team ID 为 `UQ87N2WZ76`，并附加 Apple 公证票据。请同时核对 Release 中的 SHA-256。
