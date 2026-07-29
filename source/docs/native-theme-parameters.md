# Agent 原生深浅主题参数

皮肤模式的唯一协议字段是 `official.variant`，只允许 `light` 或 `dark`。应用皮肤后，灵妆会锁定该模式；用户不应在目标 Agent 内再次切换外观。取消皮肤时恢复 Agent 原来的根主题状态。

## WorkBuddy 5.2.6 / 5.3.3

- 根开关：`theme-mode`、`data-theme`、根节点 `light` / `dark` class。
- 专家中心开关：`expert-center-light` / `expert-center-dark`。
- 页面表面：`--ec-bg-primary`、`--ec-bg-secondary`、`--ec-bg-tertiary`。
- 卡片：`--ec-expert-card-bg`、`--ec-expert-card-hover-bg`、`--ec-card-border-static`、`--ec-expert-card-hover-border`、`--ec-expert-card-shadow`。
- 文字：`--ec-text-primary`、`--ec-text-strong`、`--ec-text-secondary`、`--ec-text-muted`、`--ec-text-desc`、`--ec-text-placeholder`。
- Tab 与筛选：`--ec-filter-text`、`--ec-filter-text-hover`、`--ec-filter-text-active`、`--ec-filter-border`。
- 按钮与搜索：`--ec-btn-bg`、`--ec-btn-bg-hover`、`--ec-btn-text`、`--ec-search-bg`、`--ec-search-text`。
- 精选场景：`--ec-featured-scene-bg`、`--ec-featured-scene-overlay`、`--ec-featured-scene-tag-bg`、`--ec-featured-scene-tag-color`。

## Codex 26.715

- 模式来源：`official.variant` 与官方主题字符串；根节点锁定 `light` / `dark` class 和 `color-scheme`。
- 页面表面：`--color-token-bg-primary`、`--color-token-bg-secondary`、`--color-token-bg-tertiary`、`--color-token-main-surface-primary`、`--color-token-side-bar-background`。
- 编辑与输入：`--color-token-editor-background`、`--color-token-input-background`、`--color-token-dropdown-background`、`--color-token-menu-background`。
- 文字：`--color-token-text-primary`、`--color-token-text-secondary`、`--color-token-text-tertiary`、`--color-token-foreground`、`--color-token-description-foreground`、`--color-token-input-placeholder-foreground`。
- 交互：`--color-token-interactive-bg-secondary-selected`、`--color-token-interactive-bg-secondary-hover`、`--color-token-interactive-label-accent-default`。
- 边框与代码：`--color-token-border`、`--color-token-border-default`、`--color-token-border-light`、`--color-token-text-code-block-background`、`--color-token-diff-surface`。

## 豆包 2.19.9

- 根开关：`theme-mode`、`data-theme`、根节点 `light` / `dark` class 和 `color-scheme`。
- 页面表面：`--semi-color-bg-0`、`--semi-color-bg-1`、`--semi-color-bg-2`、`--semi-color-bg-3`。
- 文字：`--semi-color-text-0`、`--semi-color-text-1`、`--semi-color-text-2`、`--semi-color-text-3`。
- 填充与边框：`--semi-color-fill-0`、`--semi-color-fill-1`、`--semi-color-fill-2`、`--semi-color-border`、`--semi-color-focus-border`。
- 强调色：`--semi-color-primary`、`--semi-color-primary-hover`、`--semi-color-primary-active`。

机器可读映射位于 `src/native-theme-params.mjs`。客户端升级后，应先更新该映射和适配器证据，再允许新版本使用高级皮肤能力。
