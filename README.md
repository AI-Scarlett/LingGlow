# LingGlow / 灵妆

**macOS AI Agent 主题、皮肤与个性化管理工具，支持 Codex/GPT、WorkBuddy 与豆包。**  
**A macOS theme and skin manager for Codex/GPT, WorkBuddy, and Doubao.**

[官方网站](https://aiaiai.homes/) · [下载最新版](https://github.com/AI-Scarlett/LingGlow/releases/latest) · [皮肤图鉴](catalog/v1/GALLERY.md) · [安装手册](docs/USER-GUIDE.md) · [English](#english)

![LingGlow skin library](docs/images/lingglow-2.3.0-skins.png)

灵妆让用户无需修改 Agent 源码，即可浏览、下载、更新和应用经过完整性校验的主题皮肤。它会根据目标客户端与深浅模式处理背景、文字、卡片、弹窗、输入框、首页专图与 WorkBuddy 机器人图片，并保留恢复官方原版的入口。

> 本仓库只发布签名公证安装包、远程皮肤目录、皮肤预览、用户文档和皮肤制作 Skill，**不发布灵妆应用源码**。

## 当前公开版本：2.3.4

- Codex 新建任务与对话页现在完整显示主题背景，并适配场景区块、选中态、模型与权限菜单、输入框、发送/停止和麦克风控件。
- WorkBuddy 移除标题、正文、标签和占位文字周围多余的独立底框；可读性背景改由圆角结构容器或边缘渐隐承担。
- 豆包修复部分页面的大块黑色遮罩，以及浅色皮肤继续使用浅色文字的问题。
- 三端文字颜色统一依据实际绘制表面计算，不再只跟随客户端的深浅模式标记。
- Skin Abstract 制作规范与三端回归清单同步更新，防止新皮肤重新引入逐字底框和不可读文字。

[查看 LingGlow 2.3.4 完整更新说明](https://github.com/AI-Scarlett/LingGlow/releases/tag/v2.3.4)

## 主打皮肤 / Featured Skins

| 西班牙世界杯夺冠 | 八仙群像 | 何仙姑 |
|---|---|---|
| ![Spain World Cup Champions](catalog/v1/previews/spain-2026-champions.webp) | ![Baxian Ensemble](catalog/v1/previews/baxian-ensemble.webp) | ![He Xiangu](catalog/v1/previews/baxian-he-xiangu.webp) |
| 免费 · 足球 · 推荐 | 免费 · 八仙系列 · 推荐 | 免费 · 八仙系列 · 推荐 |

当前目录共 25 套皮肤，其中 18 套免费、7 套 VIP。八仙九套系列与世界杯夺冠主题均为免费皮肤。

## 核心能力

- **三端管理**：Codex/GPT、WorkBuddy、豆包使用各自真实客户端图标与独立适配能力。
- **按需下载**：DMG 不再携带全部大图，用户只下载需要的皮肤。
- **我的皮肤**：统一查看已下载、已购买、适用 Agent 和更新状态。
- **推荐陈列**：通过 `featured` 元数据持续上新主打皮肤，不要求升级 App。
- **深浅模式**：皮肤声明 light/dark，语义文字和控件颜色不直接套用背景图颜色。
- **安全目录**：只允许声明式 JSON 与静态 WebP，包、定义文件和图片均校验 SHA-256。
- **安全更新**：App 更新校验摘要、Bundle ID、Developer Team ID、Developer ID 签名与 Apple 公证。
- **可恢复**：应用前检查客户端签名和兼容级别，并保留恢复官方原版入口。

## 下载与安装

前往 [GitHub Releases](https://github.com/AI-Scarlett/LingGlow/releases/latest)：

- 下载当前 Release 中的 `LingGlow-2.3.4-macOS.dmg` 和 `SHA256SUMS`
- 系统要求：macOS 13 或更高版本

只从本仓库的正式 Release 下载。DMG 与 App 使用 Developer ID 签名并附加 Apple 公证票据；完整步骤见 [安装与使用手册](docs/USER-GUIDE.md)。

## 皮肤下载与更新

1. 打开灵妆并选择 WorkBuddy、豆包或 Codex/GPT。
2. 在“推荐”或“全部”浏览预览，点击“下载”。
3. 在“我的皮肤”查看已下载、已购买和有更新的皮肤。
4. 点击“应用”，确认后仅重启所选 Agent。
5. 需要撤销时点击“恢复原版”。

远程目录：[catalog/v1/index.json](catalog/v1/index.json)  
完整图鉴：[catalog/v1/GALLERY.md](catalog/v1/GALLERY.md)

## 购买、授权与隐私

购买前必须勾选《购买说明》和《隐私政策》。未勾选时购买按钮仍可点击，但会弹窗要求阅读并同意后才能进入 Dodo Payments 官方托管支付页。

- [隐私政策](docs/PRIVACY.md)
- [购买说明](docs/PURCHASE-TERMS.md)
- 数字授权与虚拟皮肤除适用法律或 Dodo Payments 规则另有规定外不支持退货退款
- 客户端不嵌入商户 API Key，不收集银行卡信息

## 使用 Skill 制作皮肤

[`skills/skin-abstract`](skills/skin-abstract) 提供统一的三端皮肤制作流程，包括图片规格、深浅模式、语义对比度、Codex 首页专图、WorkBuddy 机器人透明图和真实客户端 QA。

查看 [使用 Skin Skill 制作皮肤](docs/CREATE-SKIN-WITH-SKILL.md)。

## English

LingGlow is a macOS AI agent theme and skin manager for **Codex/GPT, WorkBuddy, and Doubao**. It provides a remote skin catalog, featured collections, a personal “My Skins” library, per-agent compatibility labels, verified downloads, light/dark appearance profiles, secure app updates, and a reusable skin-authoring Skill.

- Official website: [https://aiaiai.homes/](https://aiaiai.homes/)
- Download: [Latest GitHub Release](https://github.com/AI-Scarlett/LingGlow/releases/latest)
- Supported languages: Simplified Chinese and English
- Supported platform: macOS 13+
- Supported clients: Codex/GPT, WorkBuddy, Doubao

## FAQ

### Is LingGlow an official OpenAI, WorkBuddy, or Doubao product?

No. LingGlow is an independent personalization utility and is not affiliated with or endorsed by those client vendors.

### Does LingGlow modify conversations or account data?

No. Skin packages contain declarative theme data and static images. LingGlow does not copy client login data or conversation content.

### Why are some effects limited?

LingGlow fails closed when a client version or capability has not been verified. Generic-safe mode only applies capabilities considered safe for the detected build.

### Can skins update without reinstalling LingGlow?

Yes. App updates and skin catalog updates use separate channels.

## Repository Contents

- `catalog/v1/`: remote catalog, metadata, and preview gallery
- `skills/skin-abstract/`: reusable skin creation Skill
- `docs/`: installation, creation, privacy, purchase, and product facts
- `latest.json`: signed-release update manifest
- Releases: notarized DMGs, checksums, and downloadable skin bundles

**Search topics:** macOS AI agent themes, Codex themes, ChatGPT desktop skins, WorkBuddy themes, Doubao skins, AI assistant personalization, macOS skin manager, 灵妆, Codex 换肤, WorkBuddy 皮肤, 豆包皮肤。
