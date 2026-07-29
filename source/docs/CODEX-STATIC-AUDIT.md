# Codex macOS 26.707.91948 静态适配审计

## 结论

当前安装的 Codex 实际位于 `/Applications/ChatGPT.app`，其静态元数据为 `com.openai.codex`、Team ID `2DC432GLL2`、版本 `26.707.91948`、构建 `5440`，内含 Electron `42.1.0` 与 Chromium `150.0.7871.115`。原始 ASAR 仍为 `85b11c8...`。

最初的 2026-07-17 静态快照采集于 `loginwindow / IOConsoleLocked` 状态：Doubao、ChatGPT 与 WorkBuddy 的系统验证都同时返回 `Authority unavailable`，Gatekeeper 同时返回 internal error。这只说明当时 macOS Code Signing 子系统不可用，**不能据此断言 ChatGPT.app 被修改或损坏**；也不能把 Bundle ID、Team ID、CDHash 或 ASAR 哈希当成签名替代品。

随后在解锁态执行的只读 `node src/cli.mjs doctor` 已重新得到 `signatureValid: true`，因此当前 5440 Provider 可进入 `generic-safe`（仅 background / palette / glass）。这也不改变静态候选的边界：即使签名通过，5440 在隔离运行矩阵完成前仍不能成为 `exact`。

仓库保留旧构建 `26.707.72221 / 5307` 的 Adapter 哈希作历史比对，但它没有当前规则要求的摘要锁定隔离运行证据，加载器不会再将其视为 `exact`。当前新增的 `codex-macos-26.707.91948-build-5440-static-candidate` 锁定当前 ASAR、单一 `app://-/index.html` target 白名单、静态语义选择器和候选 capability，但 `validation.status=static-candidate`，所以永远不会进入 `exact` 或开启 candidate capability。只有摘要哈希锁定的隔离运行矩阵被人工批准后，才能把候选提升为 runtime-verified adapter。

静态包里仍保留了相当好的升级基础：侧栏、项目、线程、Composer、Diff 和设置导航有大量语义 `data-*`；官方主题代码会生成 `--codex-base-*` 与一整套 `--color-token-*`；侧栏宽度也由 `--spacing-token-sidebar` 驱动。但这些证据只证明代码存在，不证明每个路由和状态下的运行时 DOM，因此候选只登记 `composer` 与 `sidebar-width`，并继续保持运行门禁；Banner、Logo、发送/停止专用状态和 motion 没有被猜测为已支持。

机器可读证据保存在 [`qa/codex-static-26.707.91948.json`](../qa/codex-static-26.707.91948.json)。

## 本次安全边界

本次是严格的静态审计：

- 没有连接当前 Codex 的 CDP；
- 没有读取当前任务的页面 DOM；
- 没有退出、重启或启动第二个 Codex；
- 没有修改 `/Applications/ChatGPT.app`、`app.asar` 或用户数据；
- 没有把“包内字符串存在”写成“运行时已经验证”。

状态用语固定如下：

| 状态 | 含义 |
|---|---|
| `verified-static` | 直接从签名应用、Info.plist、ASAR 字节或打包代码确认 |
| `candidate-static` | 静态代码中有语义选择器或令牌，但运行时存在性、状态覆盖未确认 |
| `pending-runtime` | 隔离运行 QA 前必须保持关闭 |

OpenAI 官方 Codex 手册只用于确认产品表面与能力边界；官方文档没有承诺桌面端 DOM、私有 `data-*` 或资源文件名稳定。下面所有内部适配结论均来自本机已安装包，不能视为官方扩展 API。

## 应用身份与完整性

| 项目 | 静态结果 |
|---|---|
| 路径 | `/Applications/ChatGPT.app` |
| 显示名 / 签名基名 | `ChatGPT` / `Codex` |
| Bundle ID | `com.openai.codex` |
| Version / Build | `26.707.91948` / `5440` |
| Team ID | `2DC432GLL2` |
| CDHash | `3972f0bc0675d00e71d20be5009b5b5c22b3d905` |
| 签名 | 首次锁屏快照中 Code Signing 子系统不可用；后续解锁态只读 `doctor` 已重新核验通过 |
| Gatekeeper | 锁屏快照中曾统一 internal error；仅作为当时的主机状态记录，不能作为 App 损坏证据 |
| Chromium | `150.0.7871.115` |
| Electron / Vite | `42.1.0` / `8.0.3` |
| ASAR entries | `6010` |
| ASAR raw SHA-256 | `85b11c8d93d377f82161ba9b7b1af6f95b2a0490f01993dbc4d3a107dce77591` |
| Electron ASAR integrity | `9672c276b4b9a0d7f566990988a3434d4d1281f345dbc268e3cba0af646cc7b2` |
| Renderer entry | `webview/index.html` |
| Renderer SHA-256 | `f952f2510993493610c026bfb65d3ff527a8c2a824a6a46623af49ff334b9789` |

Electron 的 `ElectronAsarIntegrity` 是包内完整性元数据，不能简单当成原始 `app.asar` 文件哈希；快照同时记录两者，升级比较应分别比较。

`package.json` 进一步确认：

- package name：`openai-codex-electron`；
- product name：`Codex`；
- build flavor：`prod`；
- package brand：`chatgpt`；
- main：`.vite/build/early-bootstrap.js`。

静态主题注册表还包含 26 个 `codex.codeThemeId`：`codex`、`dracula`、`everforest`、`github`、`gruvbox`、`linear`、`lobster`、`material`、`matrix`、`monokai`、`absolutely`、`night-owl`、`nord`、`notion`、`oscurange`、`one`、`proof`、`raycast`、`rose-pine`、`sentry`、`solarized`、`temple`、`tokyo-night`、`vercel`、`vscode-plus`、`xcode`。列表属于当前构建快照，升级后必须重新枚举。

## Adapter 漂移

| 项目 | 仓库旧历史 Adapter（不再激活） | 当前 5440 静态候选 |
|---|---|---|
| Version | `26.707.72221` | `26.707.91948` |
| Build | `5307` | `5440` |
| ASAR SHA-256 | `b5da51e5df6e...` | `85b11c8d93d...` |
| 适配等级 | 历史哈希参考；缺少现行运行证据时只可 `generic-safe` | `static-candidate`；当前签名已重新核验，因此仅 `generic-safe`，仍不能进入 exact |

摘要锁定的静态 ASAR 扫描满足 `themeShareV1 / appUrlEntry / semanticSelectors / designTokens / productMarker`。当前签名信任已经重新建立，但候选仍没有通过运行矩阵，所以 `src/adapter.mjs` 只开放 generic-safe 的 fail-closed 行为是正确的。

当前主机已经可用的 generic-safe 能力为：

- `background`
- `palette`
- `glass`

以下能力保持关闭；其中只有 `composer / sidebar-width` 已进入静态候选，仍须完成隔离运行验证，其他项尚未进入候选：

- `composer`
- `banner`
- `motion`
- `sidebar-width`
- `brand`
- `navigation`
- `controls`
- `project-hero`

## 5440 静态候选 Adapter 与运行门禁

候选文件位于 [`adapters/codex-macos-26.707.91948-build-5440-static-candidate.json`](../adapters/codex-macos-26.707.91948-build-5440-static-candidate.json)。它不是 exact adapter，关键约束是：

```json
{
  "targetUrl": "app://-/index.html",
  "targetAllowlist": ["app://-/index.html"],
  "capabilities": ["background", "palette", "glass", "composer", "sidebar-width"],
  "validation": {
    "status": "static-candidate",
    "staticBaseline": "qa/codex-static-26.707.91948.json",
    "runtimeEvidenceRequired": true,
    "runtimeEvidenceKind": "lingglow.codex-isolated-qa-evidence"
  }
}
```

`loadAdapters()` 会重新计算静态基线 SHA-256，并检查基线中的 Bundle ID、Team ID、Version、Build、raw ASAR 与 adapter 一致。即使命中全部静态字段，`compatibilityFor()` 也只返回 `generic-safe`，并把候选放在 `candidateAdapter` 供 Doctor 解释；`adapter` 保持 `null`，candidate 的 `composer / sidebar-width` 不会进入编译能力交集。

未来提升为 `runtime-verified` 时，摘要锁定的运行证据还必须同时证明：

- target 仍严格限制为顶层 `app://-/index.html`；query/hash 可以存在，其他 scheme、host 或 path 一律拒绝；
- `Browser.getVersion` 必须精确匹配静态基线 Chromium，且证据只能声明 `direct-pipe` / `pipe`、完整的一页 target inventory 和已移除测试 CSS；
- 首页、项目、local/remote thread、Diff Review、设置和插件七类路由都已覆盖；
- 侧栏展开/折叠，Composer idle/send/stop/queue，浅色/深色，窄窗口与 reduced-motion 十类状态都已覆盖；
- `capabilitiesVerified` 与 adapter 声明完全相同；
- cleanup、stock restore 通过，ASAR before/after 与静态基线完全相同；
- 证据状态为人工审查后的 `exact-promotion-approved`，普通 `candidate-runtime-probe` 不能提升。
- evidence 还要反向绑定 exact `adapterId`、静态候选 Adapter ID、静态基线 SHA-256 和格式受限的人工 `reviewRecordId`；只靠一个“运行成功”的 JSON 不能提升。
- `loadAdapters()` 完成全部摘要与字段验证后才在该 Adapter 实例上保存私有内存审查标记；手工构造、对象展开或反序列化副本即使字段相同，也不能让 `compatibilityFor()` 返回 `exact`。

这一门禁由 `tests/codex-static-candidate.test.mjs` 覆盖，避免把静态字符串命中或一次页面探针误当成生产 exact 证据。

## 页面与语义选择器

### 首页、项目和壳层

静态候选：

```css
[data-home-ambient-suggestions]
[data-projects-header]
[data-projects-rows]
[data-project-row]
[data-project-row-wrapper]
[data-task-list-item]
[data-app-shell-main-content-layout]
[data-app-shell-main-content-top-fade]
[data-app-shell-header-edge-scroll]
[data-app-shell-sidebar-trigger]
[data-app-shell-tabs]
[data-app-shell-tab-strip-controller]
[data-app-shell-tab-controller]
[data-app-shell-tab-panel-controller]
```

这些属性比 Vite chunk 名、Tailwind class 或 `nth-child` 更适合作为未来 adapter 候选，但仍必须在首页、项目列表、空状态、窗口缩放和浅/深色模式逐一验证。

### 左侧栏

静态候选：

```css
[data-app-action-sidebar-scroll]
[data-app-action-sidebar-section]
[data-app-action-sidebar-section-heading]
[data-app-action-sidebar-section-toggle]
[data-app-action-sidebar-project-row]
[data-app-action-sidebar-project-id]
[data-app-action-sidebar-project-label]
[data-app-action-sidebar-project-list-id]
[data-app-action-sidebar-select-project]
[data-app-action-sidebar-thread-row]
[data-app-action-sidebar-thread-id]
[data-app-action-sidebar-thread-title]
[data-app-action-sidebar-thread-active]
[data-app-action-sidebar-thread-pinned]
```

`--spacing-token-sidebar` 在主 CSS 中有明确默认值：

```css
--spacing-token-sidebar: clamp(240px, 275px, min(520px, calc(100vw - 320px)));
```

并被 `w-token-sidebar`、计算宽度和左侧 padding 使用。它是 `layout.sidebarWidth` 的强静态候选；但还要验证窄窗口、侧栏折叠、设置页、任务页与多 Tab，才能从 `pending` 升为 `supported`。

### 任务、线程与 Composer

静态候选：

```css
[data-app-action-timeline-scroll]
[data-thread-title]
[data-thread-title-trigger]
[data-thread-scroll-footer]
[data-thread-find-target]
[data-thread-find-composer]
[data-local-conversation-final-assistant]
[data-local-conversation-user-anchor]
[data-turn-key]
[data-virtualized-turn-content]

[data-codex-composer]
[data-codex-composer-root]
[data-codex-composer-request-navigation]
[data-composer-attachments-row]
[data-composer-attachment-pill]
[data-composer-overlay-floating-ui]
[data-composer-utility-bar-scroll-area]
[data-above-composer-portal]
[data-above-composer-queue-portal]
```

Composer 的根属性具有较高价值，未来可以用于面板色、玻璃、边框和圆角。但语音、附件、队列、计划模式、云任务、本地任务、受限会话和错误态会改变内部结构，运行测试必须覆盖这些状态。

### 发送与停止按钮

结论是 `pending-runtime`，不能现在写死选择器。

当前静态组件最终渲染 `button[type="button"]`，可访问名称来自动态、本地化的 `aria-label`。消息键为：

- `composer.submitButtonTooltip.send`，英文默认值 `Send`；
- `composer.submitButtonTooltip.stop`，英文默认值 `Stop`。

同一按钮组件还会在 Send、Stop、Queue、Steer、提交中和禁用之间切换，图标也会按云端/本地模式变化。没有找到稳定的 send/stop 专用 `data-*`。因此：

- 不能把 `button[aria-label="Send"]` 或 `button[aria-label="Stop"]` 当跨语言适配器；
- 不能把 `send-*.js`、`circle-stop-*.js` 等 chunk 文件名当 DOM hook；
- 当前可安全改变的是按钮相关设计令牌；
- 若要单独控制发送/停止状态，必须在隔离实例里以 `[data-codex-composer]` 为边界，用 role/name 做探测并验证每种状态；探测结果不能直接变成依赖英文文案的生产 CSS。

### Diff 与 Review

静态候选：

```css
[data-diff]
[data-diff-type]
[data-diff-span]
[data-diffs-header]
[data-review-path]
[data-app-action-review-scroll]
[data-app-action-review-file-toggle]
[data-review-diff-metrics-probe]
[data-review-file-source-metrics-probe]
```

这里同时有专用 Diff token，优先级应是“语义色/令牌优先、结构选择器补充”，不要直接覆盖 Monaco 或内部行节点。

### 设置与插件

设置导航按钮静态包含：

```css
[data-settings-panel-slug]
```

其值是动态 slug，适合运行时枚举，而不应在静态 adapter 中猜完整 slug 列表。

`plugins-page` 和 `plugin-detail-page` chunk 均存在，但本次扫描没有找到 plugin 专用稳定 `data-*`。插件页目前只能依赖通用 surface/text/border token；插件卡片级重绘保持 `pending-runtime`。

## 设计令牌

### 官方主题输入

包内官方主题生成器会写入：

```css
--codex-base-accent
--codex-base-contrast
--codex-base-ink
--codex-base-surface
```

这与现有 `codex-theme-v1` 处理链一致，是当前最稳的调色入口。

### 高价值通用令牌

| 目的 | 令牌 |
|---|---|
| 主/侧栏表面 | `--color-token-main-surface-primary`, `--color-token-side-bar-background` |
| 弹层/输入/编辑器 | `--color-token-dropdown-background`, `--color-token-input-background`, `--color-token-editor-background` |
| 文本 | `--color-token-foreground`, `--color-token-text-primary/secondary/tertiary` |
| 边框/焦点 | `--color-token-border/default/heavy/light`, `--color-token-focus-border` |
| 按钮 | `--color-token-button-background/border/foreground`, `--color-token-button-secondary-hover-background` |
| 交互态 | `--color-token-interactive-bg-secondary-hover/press/selected` |
| Diff | `--color-token-diff-editor-inserted-line-background`, `--color-token-diff-editor-removed-line-background`, `--codex-diffs-surface` |
| 圆角/布局 | `--codex-corner-radius-scale`, `--codex-corner-shape`, `--spacing-token-sidebar`, `--radius-token-composer-single-line` |

令牌名称仍属于桌面实现细节，不是官方承诺 API；升级时必须重新扫包，并用运行探针确认计算样式非空。

## Logo、Banner 与资源槽

静态包里发现：

| 资源 | 尺寸 | SHA-256 前缀 | 实际静态用途 |
|---|---:|---|---|
| `codex-app-ga-logo--UgmJjKM.png` | 104×104 | `8e82b26c98a1` | 品牌/迁移界面，不等于 app-shell Logo |
| `codex-home-hero-dark-still-43PvFxTG.png` | 368×368 | `104832bf01a1` | Codex mobile setup dialog |
| `codex-home-hero-light-still-CQ7cy4qg.png` | 368×368 | `ea0e54684318` | Codex mobile setup dialog |
| `codex-spritesheet-v6-BRBFriCM.webp` | 未解析 | `ac2990f24d55` | Codex avatar 动画 |

`webview/index.html` 还包含启动阶段的内联 Logo/mask。它只属于启动页，不应被当成运行时左上角 Logo。

本次没有找到：

- app-shell Logo 专用稳定 `data-*`；
- 主首页/项目页 Banner 专用稳定 `data-*`；
- 能把上述资源安全映射成“用户可替换图片位”的静态证据。

因此现有并集字段应这样处理：

| 并集字段 | 当前 Codex 结论 |
|---|---|
| `background.*` | 保持 supported；generic-safe 可消费 |
| `brand.*` / `brand.iconImage` | 保持 pending；没有 app-shell Logo 稳定槽 |
| `codex.banner.*` | 保持 pending；当前只是一层固定 overlay 概念，不对应已确认的原生 Banner |
| `layout.sidebarWidth` | 强静态候选，但隔离运行前保持 pending |
| `motion.preset` | 保持 pending；需验证 reduced-motion 与性能 |
| `semantic.diffAdded/diffRemoved` | 官方主题与 Diff token 可承接 |
| `shape.radius` | 需要复核能力映射，见下节 |

不要新增 `codex.homeHero.*` 或 `codex.logo.*`：现有 `codex.banner.*` 与 `brand.iconImage` 足够承载概念，真正缺的是经过验证的客户端投影，而不是更多存储字段。

### 完整字段分组

| 分组 | 字段 | 本次结论 |
|---|---|---|
| 通用基础/颜色 | `advanced.enabled`, `appearance.*` | 维持 supported；官方主题或 generic-safe |
| 通用字体 | `typography.codeFont/uiFont` | 维持 supported；走官方主题 |
| 通用语义色 | `semantic.diffAdded/diffRemoved/skill` | 维持 supported；官方主题与 token 均有静态证据 |
| 通用背景 | `background.image/opacity/overlay/blur/position` | 维持 supported；当前 generic-safe 可消费 |
| 通用玻璃 | `glass.enabled/opacity/blur` | 维持 supported；当前 generic-safe 可消费 |
| 通用品牌 | `brand.enabled/displayName/shortMark/logoStyle/iconImage` | 维持 pending；缺 app-shell Logo 运行证据 |
| 通用动效 | `motion.preset` | 维持 pending |
| 通用侧栏宽度 | `layout.sidebarWidth` | 强静态候选，维持 pending |
| 通用圆角 | `shape.radius` | 当前 map 与 generic 编译路径需复核 |
| Codex 专属官方 | `window.opaque`, `codex.codeThemeId` | 维持 supported |
| Codex 专属横幅 | `codex.banner.enabled/image/opacity/height/width/position` | 维持 pending；无已确认原生 Banner 槽 |

## 并集 Schema 的安全修正

静态审计发现 `shape.radius` 原先在 Codex capability map 中标为 `supported`，但当前安装版因 adapter 漂移只获得 `background / palette / glass`；`src/skin.mjs` 的 Composer/control 圆角规则又位于 exact capability 分支。

该不一致已经修正：Codex 的 `shape.radius` 现在保持 `pending`，不会进入当前 `5440 generic-safe` 的客户端编译投影。只有未来 exact adapter 的运行时验证覆盖相关控件，或圆角被实现成经过证明的 generic-safe 令牌投影后，才能将它升级为 `supported`。

## 安全的第二实例 QA 方案（防误运行脚本已完成，仍未执行）

包内 bootstrap 提供了比通用 `--user-data-dir` 更明确的隔离入口：

```text
CODEX_ELECTRON_USER_DATA_PATH
```

静态代码确认它会先执行：

```text
app.setPath("userData", resolvedPath)
```

然后才执行：

```text
app.requestSingleInstanceLock()
```

这说明独立 userData 是未来第二实例测试的正确基础，且单实例锁很可能随该路径隔离；但本次没有启动验证，所以仍标 `pending-runtime`。

推荐顺序：

1. 最稳方案是单独 macOS 用户或一次性 VM，使用测试账号和空项目。
2. 在该边界内建立权限 `0700` 的临时目录，并设置独立 `CODEX_ELECTRON_USER_DATA_PATH`。
3. 同时设置独立 `CODEX_HOME`，禁用不需要的远程插件，不放真实项目和生产凭据。
4. 直接启动已验证签名的 `Contents/MacOS/ChatGPT`，使用继承文件描述符的 `--remote-debugging-pipe`，不开放 TCP 调试端口。
5. 先校验 `Browser.getVersion` 与锁定的 Chromium 一致，再只允许 `app://-/index.html` page target。
6. 先做结构探针：`#root`、窗口类型、设计令牌、路由和候选选择器计数；结构不匹配立即停止，不注入。
7. 按路由和状态截图/计算样式验证：首页、项目、任务、侧栏折叠、Composer 空闲/发送/停止/队列、Diff、设置、插件、浅/深色、窄窗口、reduced-motion。
8. 测试 CSS 只在该隔离 `app://-/index.html` renderer 内短暂安装；先移除新文档脚本与当前 renderer CSS，再恢复页面。
9. 按 PID/PPID 记录从已 spawn 子进程观察到的隔离进程树，先等待 `SIGTERM`；只在这些已记录的后代仍存活时才升级为 `SIGKILL`。确认没有已记录进程或仍引用临时根的进程后，才删除该临时根。
10. 只有签名、版本、ASAR、Browser 版本、目标 URL、结构矩阵和恢复测试全部通过，才生成并启用新 exact adapter。

仓库中的 `tests/integration-isolated.mjs` 现在强制使用上述产品级隔离变量，不再使用通用 `--user-data-dir`。它在启动前同时要求：

```text
LINGGLOW_CODEX_QA_ACK=I_ACCEPT_A_SECOND_CODEX_IN_A_SEPARATE_TEST_ACCOUNT
LINGGLOW_CODEX_QA_BOUNDARY=separate-macos-user-or-disposable-vm
```

确认文本的含义是：**仅在独立 macOS 用户或一次性 VM 的隔离 Codex 目标中安装并移除测试 CSS，绝不触碰当前 Codex 会话。** 除了人工确认，脚本还会读取自身完整父进程链；一旦祖先命令属于 `ChatGPT.app`、`Codex.app` 或明确的 `codex` / `chatgpt` 可执行文件，便会 fail-closed 拒绝运行。因此不能从当前 Codex 会话的终端执行它。

脚本会锁定本审计记录的 Bundle ID、Team ID、版本、构建、Chromium 与原始 ASAR SHA，只允许 `--remote-debugging-pipe`，清除 API Key、SSH Agent 与真实 `CODEX_HOME` 等继承环境，并输出不含页面文本的候选选择器计数证据。临时根创建后的所有步骤都处在 `try/finally` 中：异常时仍会先尝试移除隔离 renderer 的测试 CSS，再按已跟踪 PID/PPID 后代树清理，并且只有验证无残留进程后才删除 `0700` 临时根。输出固定标记 `exactAdapterEnabled: false`；它不会写入 adapter，也不会把一次结构探测当成完整路由/状态矩阵。当前任务依赖正在运行的 Codex，因此本次明确没有执行该脚本。

独立 Electron `userData` 不能自动隔离 macOS Keychain、系统凭据、HOME 或任意文件路径，所以真实安全边界仍是单独 OS 用户/VM。不能在当前任务仍运行于 Codex 内时拿它做验证对象。

## 升级建议

下一次 Codex 更新后按固定顺序执行：

1. 重新验证 Bundle ID、Team ID、签名、公证、Version、Build、Chromium、Electron。
2. 计算 raw ASAR、Electron integrity、renderer entry、主 CSS 与关键 chunk 哈希。
3. 重新扫描语义 `data-*`、主题输入、surface/control/diff token。
4. 比较本快照，生成 added/removed/changed 报告。
5. 若静态基线通过，再在隔离实例跑路由与状态矩阵。
6. 仅把运行验证通过的 capability 写入新 exact adapter；其他能力保持 fail-closed。
7. 回归测试 stock 启动、应用、刷新、路由切换、清理和完全恢复。

这个流程允许灵妆吸收 Codex 新版本变化，同时避免旧 CSS“看起来还能用”就越过版本指纹和安全门。
