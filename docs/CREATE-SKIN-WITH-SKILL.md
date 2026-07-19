# 使用 Skin Skill 制作灵妆皮肤

## 安装 Skill

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

## 最少需要准备的内容

- 皮肤名称、稳定的英文 `skinId`、免费/VIP 等级。
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

## 示例提示词

```text
使用 $skin-abstract 制作一套名为“雨夜电台”的深色免费皮肤。
适配 Codex、WorkBuddy 和豆包。全局背景使用我提供的夜雨城市图片，
Codex 首页图要另外生成一张相关的 3:1 电台控制室图片，
WorkBuddy 机器人替换为我提供的透明小猫。
请保证历史对话、输入框、模型菜单、专家页和弹窗可读、可点击，
并输出符合 LingGlow Remote Distribution v1 的 Theme Pack。
```

## 制作流程

1. Skill 记录三个 Agent 的目标版本和原生明暗模式。
2. 生成一个三端共用的 Theme Pack，按 Agent 投影不同字段。
3. 校验图片格式、尺寸、真实 Alpha、来源和再分发权利。
4. 检查全局背景与 Codex 首页图不是同一文件。
5. 在真实 WorkBuddy、豆包和 Codex 中测试首页、历史对话、输入框、菜单、弹窗和点击区域。
6. 通过回滚验证后，生成本地 Theme Pack 与预览证据。
7. 项目维护者运行 `node scripts/build_skin_distribution.mjs` 生成 `.lingglow-skin.json` 和远程目录记录。

## 发布边界

用户自己制作的皮肤默认只在本地使用。要进入官方 GitHub 目录，必须经过素材权利审查、三端真实截图、交互验证、回滚验证和维护者确认。Skill 不会绕过这些门禁，也不会自动把未经确认的皮肤上传到公共仓库。
