# 使用 Skin Skill 制作灵妆皮肤

## 安装 Skill

### 从灵妆客户端一键安装

1. 打开灵妆桌面窗口。
2. 进入左侧“设置”。
3. 在“制作自己的皮肤”中点击“安装 SKILL”。
4. 安装完成后重新打开 Codex。
5. 在新任务中输入“使用 \$skin-abstract 制作一套皮肤”，即可开始。

客户端会把签名 Release 中的 LingGlow-Skin-Skill.zip 安装到 ~/.codex/skills/lingglow-skin-maker/，不会写入目标 Agent 的应用目录。

### 从 GitHub 手动安装

公开 Skill 位于：

[`skills/skin-abstract`](https://github.com/AI-Scarlett/LingGlow/tree/main/skills/skin-abstract)

在 Codex 中可以直接提出：

```text
从 AI-Scarlett/LingGlow 的 skills/skin-abstract 安装皮肤制作 Skill。
```

也可以下载仓库 ZIP，只把 `skills/skin-abstract` 放入：

```text
~/.codex/skills/skin-abstract/
```

重新打开 Codex 后即可使用 `$skin-abstract`。

也可以从 [Releases](https://github.com/AI-Scarlett/LingGlow/releases/latest) 下载 LingGlow-Skin-Skill.zip，解压后把整个目录放入 ~/.codex/skills/lingglow-skin-maker/。

## 最少需要准备的内容

- 皮肤名称、稳定的英文 `skinId`、免费/VIP 等级。
- 一个分类、一个稳定系列 ID，以及用于搜索的简短标签。
- 明确选择浅色或深色模式。
- 一张全局背景图。
- 一张与背景风格相关但不是同一文件的 Codex 首页 3:1 图片。
- 一张透明的 WorkBuddy 机器人/吉祥物图片。
- 想显示的首页名称、标题和副标题。
- 图片来源、作者、授权和是否允许再分发。

图片建议：

| 用途 | 建议尺寸 | 比例 | 上限 |
| --- | ---: | ---: | ---: |
| 全局背景 | 2560x1600 | 16:10 | 4 MB |
| Codex 首页图片 | 2400x800 | 3:1 | 4 MB |
| WorkBuddy 首页图片 | 1920x1080 | 16:9 | 4 MB |
| WorkBuddy 机器人 | 1024x1024 | 1:1 透明 | 2 MB |
| Icon | 1024x1024 | 1:1 | 2 MB |
| GitHub 样式预览 | 1280x720 | 16:9 | 2 MB |

WorkBuddy 输入框悬浮主体不是背景图裁切。它必须是透明画布上的完整独立主体，宽高比 0.8–1.25，至少 15% 透明像素、3% 主体像素，并在四周各保留至少 3% 透明留白；文件不超过 2 MB、单边不超过 2048 px、总像素不超过 400 万。PNG/WebP 在进入皮肤包前必须运行：

```bash
node scripts/validate-composer-mascot.mjs <素材.png或webp>
```

不合格素材不会改用背景图或圆形裁图顶替。Skill 会提示“请上传透明画布上的完整独立主体，四周保留透明留白；不接受背景图、主视觉、圆形裁图或带底色图片。当前将使用默认机器人。”并把该槽位留空，交给 WorkBuddy 显示默认机器人。

## 示例提示词

```text
使用 $skin-abstract 制作一套名为“雨夜电台”的深色免费皮肤。
适配 Codex、WorkBuddy 和豆包。全局背景使用我提供的夜雨城市图片，
Codex 首页图要另外生成一张相关的 3:1 电台控制室图片，
WorkBuddy 机器人替换为我提供的透明小猫。
请保证历史对话、输入框、模型菜单、专家页和弹窗可读、可点击，
分类使用 sports，系列使用 rain-radio，标签包含雨夜、电台、深色，
并输出符合 LingGlow Remote Distribution v2 的 Theme Pack。
```

## 制作流程

1. Skill 记录三个 Agent 的目标版本和原生明暗模式。
2. 生成一个三端共用的 Theme Pack，按 Agent 投影不同字段。
3. 校验图片格式、尺寸、真实 Alpha、来源和再分发权利；WorkBuddy 悬浮主体必须通过独立校验器。
4. 检查全局背景与 Codex 首页图不是同一文件。
5. 在真实 WorkBuddy、豆包和 Codex 中测试首页、历史对话、输入框、菜单、弹窗和点击区域；WorkBuddy 新任务与历史任务输入框都必须同时检查，并且只显示一个无圆形底框的完整主体。
6. 通过回滚验证后，生成本地 Theme Pack 与预览证据。
7. 项目维护者运行 `node scripts/build_skin_distribution.mjs` 生成 `.lingglow-skin.json` 和目录协议 v2 记录；分类、系列与标签会直接用于客户端筛选和搜索。

## 在 Codex 中的完整示例

```text
使用 \$skin-abstract，基于我附加的三张图制作一套名为“海边下午茶”的浅色免费皮肤。
第一张作为全局 16:10 背景，第二张作为 Codex 和 WorkBuddy 新建任务区的 3:1 横幅，
第三张是透明机器人图。适配 WorkBuddy、豆包和 Codex。
请保持弹窗、模型菜单、历史对话和输入框可读、可点击，并输出本地预览和主题清单。
```

生成后先在本机测试。只有素材授权、三端截图、点击测试、回滚测试全部通过，才适合提交到官方目录。

## 发布边界

用户自己制作的皮肤默认只在本地使用。要进入官方 GitHub 目录，必须经过素材权利审查、三端真实截图、交互验证、回滚验证和维护者确认。Skill 不会绕过这些门禁，也不会自动把未经确认的皮肤上传到公共仓库。
