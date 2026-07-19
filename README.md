# LingGlow / 灵妆

灵妆是面向 Codex/GPT、WorkBuddy 与豆包的 macOS 主题管理工具。

本仓库只发布签名公证安装包、远程皮肤目录、皮肤样式预览、用户文档和皮肤制作 Skill，**不发布灵妆应用源码**。

## 下载灵妆

前往 [Releases](https://github.com/AI-Scarlett/LingGlow/releases/latest) 下载最新的 `LingGlow-<版本>-macOS.dmg`。

- macOS 13 或更高版本
- Universal Binary：Apple Silicon 与 Intel
- Developer Team ID：`UQ87N2WZ76`
- DMG 与 App 使用 Developer ID 签名并附加 Apple 公证票据

完整步骤见 [安装与使用手册](docs/USER-GUIDE.md)。

## 远程皮肤目录

灵妆 2.2.0 起不再把全部皮肤大图放进 DMG。App 只读取远程目录中的名称、预览、明暗模式、大小与 Agent 适配；用户点击“下载”后才下载所选皮肤。

- [皮肤目录 JSON](catalog/v1/index.json)
- [15 套皮肤样式预览](catalog/v1/GALLERY.md)
- 8 套免费皮肤，7 套 VIP 皮肤
- 每套皮肤独立下载和更新，不要求升级整个 App
- 整包、定义文件和每张 WebP 都有 SHA-256 校验
- 只允许声明式 JSON 与静态 WebP，不接受脚本或可执行内容

远程包位于 `skin-catalog-v1` Release；目录索引和预览位于本仓库 `catalog/v1/`。

## 下载和应用皮肤

1. 打开灵妆并选择 WorkBuddy、豆包或 Codex。
2. 浏览远程预览，未安装皮肤会显示下载大小。
3. 点击“下载”，等待 SHA-256 校验和本地安装完成。
4. 点击“应用”并确认重启目标 Agent。
5. 有新皮肤版本时点击“更新”，不需要重新安装灵妆。

VIP 皮肤可以预览和下载。未开通 VIP、也未兑换该皮肤密钥时，每套 VIP 皮肤可试用一次；成功启动后记为已试用，下一次重启 Agent 后失效且不能再次试用。有效 VIP 或绑定该 `skinId` 的永久密钥可重复应用。

## 使用 Skill 制作皮肤

[`skills/skin-abstract`](skills/skin-abstract) 用于制作 Codex/GPT、WorkBuddy、豆包三端浅色或深色皮肤，包括：

- 单一全局背景与客户端首页专图
- 语义文字、卡片、弹窗和输入框对比度
- WorkBuddy 透明机器人替换与真实 Alpha 检查
- Codex 独立 3:1 首页图片
- 三端真实点击、菜单、历史对话和回滚 QA
- 远程 `.lingglow-skin.json` 打包协议
- 所有配图的比例、尺寸和大小限制

查看 [使用 Skin Skill 制作皮肤](docs/CREATE-SKIN-WITH-SKILL.md)。

## 自动升级

客户端读取 [`latest.json`](latest.json)，升级前校验 SHA-256、Bundle ID、Team ID、Developer ID 签名和 Apple 公证状态。App 升级与皮肤更新是两个独立通道。

## 仓库内容

- `catalog/v1/`：远程目录和样式预览
- `skills/skin-abstract/`：皮肤制作 Skill
- `docs/`：安装、使用和制作教程
- `latest.json`：客户端升级清单
- Releases：公证 DMG、校验文件与单皮肤下载包

GitHub 自动生成的 Source code 压缩包只包含上述公开文档、目录元数据、预览和 Skill，不包含灵妆应用源码。
