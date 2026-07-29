# 三客户端发现与 Adapter 升级流程

本文件用于 Codex、WorkBuddy 或 Doubao 更新后的兼容维护。核心原则是：先验证官方身份和静态结构，再写声明式 Adapter，再做运行时探针，最后做真机/隔离测试与原版恢复。不能只因为页面“看起来正常”就把版本标为 `exact`。Doubao 第一阶段只做静态身份审计，详见 [`DOUBAO-PHASE-1.md`](DOUBAO-PHASE-1.md)。

## 当前验证基线（2026-07-24）

| 客户端 | Version / Build | ASAR SHA-256 | 当前级别 | 运行时证据 |
|---|---|---|---|---|
| Codex | `26.707.91948` / `5440` | `85b11c8d93d377f82161ba9b7b1af6f95b2a0490f01993dbc4d3a107dce77591` | `generic-safe` | 已登记摘要锁定的 static-candidate，当前解锁态的只读 `doctor` 已重新核验签名；隔离运行矩阵仍未完成，因此不能进入 `exact` |
| WorkBuddy | `5.2.6` / `5.2.6` | `c5eef2ddf63f8da45b5c268a0d9b49dc51d5652690da453721281977613ed0c5` | `exact` | 已真实退出/启动、发现规范 `file:` 目标、验证五个顶层 Tab 与 More 菜单的背景/品牌/控件；第 3 个顶层项目 Tab 异步加载后，已在官方 `/projects` landing 实机验证 Hero 的受控本地 WebP CSS `content`、`fit` 与 `position`；清理并恢复 stock，ASAR 前后哈希一致 |
| WorkBuddy | `5.3.3` / `5.3.3` | `68c9d776c2d557981cbbb6c334931e1efd3ab799032d23ba9172e3868eae3acd` | `exact` | 已真实退出/以 Pipe 启动，验证五个顶层 Tab、More 菜单、品牌、发送控件、输入区头像与官方项目 Hero；清理并恢复 stock，ASAR 前后哈希一致。严格资源校验仅受腾讯 Editor SDK 在固定路径生成的一份 64 KiB 内当前用户日志影响，代码签名仍通过 `--deep --strict --ignore-resources` 复核 |
| Doubao | `2.12.7` / `2.12.7` 与 `2.19.9` / `2.19.9` | 无 ASAR；主/嵌套/Framework/Extension 多资源 SHA-256 | `blocked` | 静态签名链与资源已锁定；`transportVerified=false`、`capabilities=[]`，未进行重启或注入 |

仓库仍保留旧版 `26.707.72221` / Build `5307` 的历史 Adapter 哈希作升级比对，但它没有当前规则要求的摘要锁定隔离运行证据，因此加载器不会再把它视为 `exact`；遇到该旧构建也只能走 `generic-safe`。5440 同样只有 `static-candidate`：即使 version/build/ASAR/静态信号全部命中，也不会误判为 `exact`。若主机无法完成严格签名验证，Provider 必须在 generic-safe 之前继续 fail closed 为 `blocked`。`qa/codex-static-26.707.91948.json` 中的 `loginwindow / IOConsoleLocked` 结果是一次历史故障快照，不是对当前安装包的永久结论。

## 新增目标 Agent

新增 Agent 先改 [`src/client-registry.mjs`](../src/client-registry.mjs)，不要在 Schema、排程、授权或 server 中另写一份 ID 数组。该注册表会驱动完整 Union 的 `clientIds`、服务端 target、租约 clientIds、v2 七日计划和 Theme Pack 可用目标；旧 catalog v1 是否适用则由 `legacyCatalog` 显式决定。

注册表条目本身**不授予换肤能力**。新 Agent 必须先保持 `runtimeStatus=blocked`，然后依次补齐：Provider 信任锚、静态 fingerprint、Adapter、固定运行时探针、隔离启动/清理/原版恢复证据、capability map 的逐字段支持状态，以及原生菜单栏 `ClientID` 显示入口。只有这些证据齐全后，才可把它设为可保存/可应用/可排程的 Agent。

## 自动发现与身份检查

`doctor` 会分别调用三个 Provider：

```bash
node src/cli.mjs doctor
```

### Codex Provider

- 环境变量：`CODEX_SKIN_STUDIO_APP`
- 固定候选：`/Applications/ChatGPT.app`、`/Applications/Codex.app` 及用户 Applications
- Spotlight Bundle ID：`com.openai.codex`
- 内置信任锚：OpenAI Team ID `2DC432GLL2`
- 静态入口：`webview/index.html`
- 运行时目标：`app://-/index.html`
- target 白名单：仅 `app://-/index.html`；只忽略 query/hash，不接受其他 scheme、host 或 path

### WorkBuddy Provider

- 环境变量：`CODEX_SKIN_STUDIO_WORKBUDDY_APP`
- 固定候选：`/Applications/WorkBuddy.app` 及用户 Applications
- Spotlight Bundle ID：`com.workbuddy.workbuddy`
- 内置信任锚：Tencent Team ID `FN2V63AD2J`
- 静态入口：`renderer/index.html`
- 运行时目标：由真实 `app.asar` + 固定相对路径生成规范 `file:` URL

### Doubao Provider

- 环境变量：`CODEX_SKIN_STUDIO_DOUBAO_APP`
- 固定候选：`/Applications/Doubao.app` 及用户 Applications
- 主/嵌套 Bundle ID：`com.bot.pc.doubao` / `com.bot.pc.doubao.browser`
- 内置信任锚：Team ID `96L78H6LMH`
- 前端入口：嵌套 Chromium Extension `side_panel.html`
- 目标白名单：固定 Extension URL 与 `https://www.doubao.com/chat/*`
- 传输：Pipe 优先、隔离 Loopback 仅预留；未验证前始终 blocked
- 静态运行提示：主/嵌套启动器与 Chromium Framework 的调试开关字符串分别扫描；只进入 `staticRuntimeHints`，永不自动设置 `transportVerified`

Provider 都会校验 Bundle ID、Team ID、版本、Build、Chromium 与客户端专用静态信号。默认要求 `codesign --verify --deep --strict` 与 sealed resources 完整；WorkBuddy 5.3.3 只对腾讯 Editor SDK 在固定架构目录生成的单份当前用户日志设置有界例外，任何其他资源漂移仍会拒绝，并继续用 `--deep --strict --ignore-resources` 验证全部代码签名。Codex/WorkBuddy 锁定 ASAR SHA-256；Doubao 锁定主/嵌套 CDHash、Framework、manifest commit、Extension 及多个前端资源 SHA-256。

## 三档结果

- `exact`：版本、Build、ASAR 哈希、静态信号和目标定义与已审查 Adapter 完全一致。
- `static-candidate`：升级元数据已锁定，但隔离路由/状态矩阵或恢复证据缺失；永远不能进入 exact，最多按普通未知版本走 generic-safe。
- `generic-safe`：官方身份可信且基础入口/产品/设计信号完整，但没有精确 Adapter；仅 `background`、`palette`、`glass`。
- `blocked`：签名、发布者、目标入口或安全信号不满足；不得绕过。

WorkBuddy 5.2.6、5.3.3 与 5.3.5 exact adapter 当前明确开放 `background / palette / glass / brand / navigation / controls / project-hero / composer-avatar`；它们仍不继承 Codex 专属的 Banner、Composer、侧栏宽度或动效规则。未知 WorkBuddy 构建只降级为 `background / palette / glass / composer-avatar`。
Doubao 不使用 `generic-safe` 降级：没有三份摘要锁定的 exact 审核证据、传输和实时 DOM 回归时，必须保持 `blocked` 和零能力。`127.0.0.1:49853` 是内部 share-plugin 端口，不是 CDP。

## 更新后的静态审计

对每个新版本记录：

1. App 的实际路径与 realpath；
2. Bundle ID、Team ID 和严格签名结果；
3. version、build、Chromium；
4. `Info.plist`、主可执行文件、`app.asar` 的文件身份；
5. `app.asar` SHA-256；
6. Provider 扫描出的静态信号；
7. 更新前后的兼容级别与禁用能力。

Codex 静态信号包括 `webview/index.html`、主题分享格式、语义选择器和设计令牌。WorkBuddy 静态信号包括 `renderer/index.html`、`@genie/workbuddy-desktop`/`main/index.js` 产品标识、标题与 `#root`、`--vscode-*` 设计令牌。

Doubao 还必须记录嵌套 App 签名、Chromium Framework 版本/哈希、主 manifest commit、Extension ID/版本、Side Panel 资源哈希与固定 target 白名单。它没有 `app.asar`，不得用空 ASAR 或主 App 单一哈希代替完整信任链。静态选择器只接纳明确的 `[data-testid=...]` 或固定 HTML 锚点；遥测事件名和埋点字符串不算 DOM 证据。若锁屏或主机 Code Signing 子系统故障导致 `codesign --verify` 无法成功，结果是“本次无法重新证明”并保持 blocked，不能写成已验签，也不能仅凭该错误断言安装包已损坏。

读取必须保持有界、只读，不解包重打 `app.asar`，不修改客户端文件。

## 新建精确 Adapter

Adapter 不能定义新的信任锚，也不能携带脚本、CSS、远程地址、任意选择器或绝对路径。

### Codex Adapter

```json
{
  "schemaVersion": 1,
  "adapterId": "codex-macos-VERSION-build-BUILD",
  "clientId": "codex",
  "bundleId": "com.openai.codex",
  "teamId": "2DC432GLL2",
  "versions": ["VERSION"],
  "builds": ["BUILD"],
  "asarSha256": ["SHA256"],
  "targetUrl": "app://-/index.html",
  "targetAllowlist": ["app://-/index.html"],
  "probeKind": "codex-v1",
  "capabilities": ["background", "palette", "glass"],
  "requiredSignals": ["themeShareV1", "appUrlEntry", "semanticSelectors", "designTokens"],
  "validation": {
    "status": "static-candidate",
    "staticBaseline": "qa/codex-static-VERSION.json",
    "staticBaselineSha256": "SHA256",
    "runtimeEvidenceRequired": true,
    "runtimeEvidenceKind": "lingglow.codex-isolated-qa-evidence"
  }
}
```

静态阶段可把有明确语义 hook 的 `composer` 或设计令牌驱动的 `sidebar-width` 登记为候选 capability，但 `validation.status=static-candidate` 会阻止它们生效。只有摘要锁定的隔离证据覆盖规定路由/状态矩阵、cleanup、stock restore 与 ASAR before/after，并经人工标记 `exact-promotion-approved` 后，才能把 Adapter 提升为 `runtime-verified`。没有稳定原生槽的 `banner`、`brand` 或动态发送/停止专用选择器不得凭猜测加入。用于逐项记录完整 target inventory、路由/状态、选择器 count-only 证明和恢复结果的机器可读清单见 [`RUNTIME-QA-COVERAGE.md`](RUNTIME-QA-COVERAGE.md)；填写清单本身不授予 exact 权限。

Codex 的 exact 证据还必须把 `schemaVersion`、exact `adapterId`、静态候选 Adapter ID、`staticBaselineSha256`、人工审批 `decision=approved` 和持久 `reviewRecordId` 同时绑定。加载器不仅重新计算两份 JSON 的摘要，还会在成功后为**该内存对象**标记已审查状态；调用方手工构造的 JSON、对象展开或 JSON 序列化后的副本都只能回落为 `generic-safe`。这使“有一份看起来正确的运行矩阵”不等于获得启动 exact 皮肤的权限。

此外 review 必须记录基线 Chromium 对应的 `Browser.getVersion`、`strategyId=direct-pipe`、`transport=pipe`、完整且唯一的 `app://-/index.html` target inventory，以及测试 CSS 已移除。任何 loopback/TCP 回退、浏览器漂移、额外 page target 或 cleanup 缺失都会拒绝加载 exact Adapter。

Adapter 的 `staticBaseline` 和 `runtimeEvidence` 可以使用 `qa/` 下的分层 JSON 路径。发行构建会保留这些受限、单链接且不超过 4 MB 的 JSON 相对路径；PNG、JPEG、WebP、截图、源码图片及其他 QA 文件一律不进入 `.app`。

### WorkBuddy Adapter

```json
{
  "schemaVersion": 1,
  "adapterId": "workbuddy-macos-VERSION-build-BUILD",
  "clientId": "workbuddy",
  "bundleId": "com.workbuddy.workbuddy",
  "teamId": "FN2V63AD2J",
  "versions": ["VERSION"],
  "builds": ["BUILD"],
  "asarSha256": ["SHA256"],
  "targetPath": "renderer/index.html",
  "probeKind": "workbuddy-v1",
  "capabilities": ["background", "palette", "glass"],
  "requiredSignals": ["appUrlEntry", "semanticSelectors", "designTokens", "productMarker"]
}
```

WorkBuddy 使用 `targetPath`，不能写某台机器的绝对 `file:` URL。加载时只接受固定安全相对路径，运行时再基于已验签 App 解析 URL。

### Doubao Exact Adapter

豆包的内置 `2.19.9` Adapter 保持 `blocked`，不因静态命中而转为可启动。新的 `exact` Adapter 必须同时引用并以 SHA-256 锁定：静态基线、一次经用户授权的隔离候选运行时证据、以及人工审核记录。审核记录必须反向绑定前两份摘要、App fingerprint、固定 target 白名单、`wrapper-forwarded-pipe` 和 capability 集合。

通过三份证据验证后，Adapter 加载器才会在进程内铸造运行时信任令牌；Pipe 启动策略只接受该令牌。JSON 中的 `verified: true`、手工对象、对象克隆或只替换其中一份证据均不能开启传输、Adapter 或皮肤能力。该流程是未来发布 exact Adapter 的门槛，不代表豆包已完成本机隔离测试。

## 运行时探针要求

静态匹配只是候选，不能替代运行时验证。

### Codex

运行时必须验证：

- base URL 精确等于 `app://-/index.html`；
- 顶层页面有且只有一个 `#root`；
- Electron 根标识与主区域存在；
- `--color-token-main-surface-primary` 等设计令牌有效；
- 若 Adapter 声明 Composer，语义 Composer 标识必须出现。

### WorkBuddy

运行时必须验证：

- base URL 精确等于 Provider 生成的规范 `file:` URL；
- 顶层页面有且只有一个 `#root`；
- `data-application-name="workbuddy"`；
- `data-electron-desktop="true"` 与 `data-platform="mac"`；
- `data-product-version` 与精确 Adapter 版本一致；
- `--vscode-editor-background` 或 `--vscode-foreground` 可读取。

探针只返回 URL、产品/平台标识、数量、布尔值和必要 CSS 变量，不读取正文、输入值、会话、终端或完整 argv。

## 测试层级

### 1. 不启动客户端的测试

```bash
npm test
```

必须覆盖 Provider/Adapter、目标路径防越界、catalog schema、WebP、客户端 CSS 编译、Apply Intent 的过期/指纹/单次消费、Ed25519、排程、登录代理、Dashboard 鉴权和直接重启 API 退役。

### 2. Codex 隔离集成测试

```bash
npm run test:integration
```

仅临时 profile 不足以隔离 Codex；必须在独立 macOS 测试用户或一次性 VM 中运行，且不得使用真实工作账号、项目目录或生产凭据。测试使用产品启动器识别的临时：

```text
CODEX_ELECTRON_USER_DATA_PATH=<temporary electron profile>
CODEX_HOME=<temporary codex home>
```

这里不能用通用 `--user-data-dir` 替代 `CODEX_ELECTRON_USER_DATA_PATH`：当前包内 bootstrap 只对后者有已锁定的静态证据。测试应验证 Pipe、匹配 Chromium 的 `Browser.getVersion`、目标 URL、结构探针、当前文档注入、新文档自动注入、非授权 URL 不注入、脚本注销、清理后重载仍为空、无残留测试进程，以及 ASAR 前后哈希一致。它还必须覆盖首页、项目、local/remote thread、Diff、设置、插件及侧栏/Composer/浅深色/窄窗口/reduced-motion 的完整矩阵。该测试会启动一个可见的隔离 Codex 窗口；执行前应明确告知操作者。

当前 `26.707.91948` 只有在重新运行完整测试并保存证据后，才能新增精确 Adapter；旧版本的历史通过结果不能自动继承。

### 3. WorkBuddy 真机测试

```bash
npm run test:workbuddy
```

WorkBuddy 测试会操作当前安装的正式 App：正常退出、以 Pipe 启动、应用一套基础皮肤、验证 `file:` 目标与 `--vscode-*` 变量、清理，再以无调试参数恢复。执行前必须保存 WorkBuddy 中尚未提交的内容，并获得明确测试授权。

无论成功还是异常，`finally` 恢复路径都应尝试恢复 stock；测试结束必须再次确认：

- 只有无调试参数的主进程；
- 灵妆 style/profile 标记不存在；
- ASAR SHA-256 与测试前一致；
- 未读取或输出完整 WorkBuddy argv。

## 真机证据记录

每个 `exact` Adapter 的发布记录至少包含：

- 测试日期与工具版本；
- 客户端 version/build/Chromium；
- Bundle ID、Team ID 与严格签名成功；
- ASAR SHA-256 before/after；
- 目标 URL 类型（Codex `app:` 或 WorkBuddy canonical `file:`）；
- 运行时探针通过项；
- 实际开放 capabilities；
- 注入、清理、新文档行为；
- 恢复后 stock 进程确认；
- 残留进程检查。

不能记录页面文本、输入框、Cookie、账号令牌、项目路径或完整进程参数。

## 发布门禁

添加 Adapter 或扩展能力前，必须满足：

1. 单元测试全部通过；
2. 对应客户端的运行时集成测试通过；
3. 恢复原版路径通过；
4. 原始 App 与 ASAR 哈希未变化；
5. `generic-safe` 与 `blocked` 回归通过；
6. Apply Intent、权益门禁和提醒不会产生静默重启；
7. WorkBuddy exact Adapter 仍只开放已验证的背景、色板、玻璃、品牌、导航、控件与项目 Hero；其余字段继续保持关闭；
8. 文档中的兼容快照与实际证据同步更新。

如果任一项缺失，只能保持 `generic-safe` 或 `blocked`，不能为了展示效果降级安全门禁。

## Adapter 分发

v2 不从网络自动下载 Adapter。文件 Adapter 随经过审查的新版本一起发布，并继续受内置信任锚、schema 与能力白名单约束。在线更新未来若实现，至少需要规范化 JSON、固定更新公钥、版本/回滚保护、staging 验证和最近两版回滚；仍不得允许 Adapter 携带可执行代码。

权益租约公钥与 Adapter 更新公钥是两个不同信任域，不能复用。当前 Dodo Payments 激活服务和正式发行公钥均未配置；升级文档中的 Ed25519 只是已实现的客户端验签接口，不代表商业服务已经上线。三类商品、不可换绑和撤销规则见 [`DODO-ENTITLEMENTS.md`](DODO-ENTITLEMENTS.md)。

## 更新异常时

1. 不手工修改 `app.asar`，不关闭签名检查；
2. 在 Dashboard 中选择对应客户端并恢复原版，或运行：

   ```bash
   node src/cli.mjs restore-stock codex
   node src/cli.mjs restore-stock workbuddy
   node src/cli.mjs restore-stock doubao
   ```

3. 保存 Doctor 的非敏感摘要；
4. 若静态基础信号仍在，保持 `generic-safe`；
5. 若入口、产品标识或签名不通过，保持 `blocked`，等待新版本审计。
