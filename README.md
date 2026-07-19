# LingGlow / 灵妆

灵妆是面向 Codex/GPT、WorkBuddy 与豆包的 macOS 主题管理工具。

本仓库仅发布：

- 已签名的 macOS DMG（位于 GitHub Releases）
- 可复用的皮肤制作 Skill（`skills/skin-abstract`）

本仓库**不包含灵妆应用源码**。GitHub 自动生成的 Source code 压缩包只包含本 README 与 Skill。

## 桌面窗口版

`v2.0.0-desktop` 将原来的临时菜单栏弹出层改为独立桌面窗口：

- 点击菜单栏灵妆图标即可显示并置前。
- 点击其他应用时窗口不会自动消失。
- 窗口支持移动、缩放，并记住上次尺寸和位置。
- 关闭窗口后灵妆仍常驻菜单栏。
- 灵妆不会出现在 Dock。

前往 [Releases](https://github.com/AI-Scarlett/LingGlow/releases) 下载 DMG。

## Skin Skill

`skills/skin-abstract` 提供三客户端皮肤制作与验收流程，包括：

- 显式浅色/深色模式契约
- 全局背景与首页专图分层
- Codex/GPT、WorkBuddy、豆包适配规则
- 弹窗、卡片、输入框与文字对比度策略
- WorkBuddy 机器人/头像真实 Alpha 棪测
- 点击遮挡防护与真实客户端截图验收矩阵

将 `skills/skin-abstract` 放入 Codex 的 Skills 目录即可使用。

## 签名状态

DMG 与应用使用 Developer ID Application 签名，Team ID：`UQ87N2WZ76`。当前构建未附加 Apple 公证票据；安装前请核对 Release 中的 SHA-256。
