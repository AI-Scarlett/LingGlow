# 能力并集 Schema v1

## 目标

灵妆不能再把“当前正在编辑哪个客户端”当成皮肤存储格式。能力并集层使用一份持久文档保存 WorkBuddy、豆包（Doubao）和 Codex 的全部已知字段，再用三个独立 capability map 决定编辑器展示状态和客户端编译投影。

核心不变量：

1. 存储是并集，编译是投影。切换客户端不会删除其他客户端字段。
2. 只有 capability map 标记为 `supported` 的字段会进入该客户端的编译结果。
3. `pending` 和 `unsupported` 字段仍可 round-trip，且绝不进入编译结果。可执行 Agent 默认只编辑 `supported` 字段；只有 `runtimeStatus=blocked` 的“仅设计草稿”模式可在本机编辑其 `pending` 字段，仍不能编译、应用、排程或注入。
4. 未知未来字段原样保存、永不编译；未来 schema 若拓宽现有字段类型，旧运行时保留原值并在编译时使用当前安全默认值。
5. 并集方案使用独立私有目录和 API；现有 profile schemaVersion 1、catalog 与历史数据目录继续兼容，不会被静默迁移或覆盖。
6. `supported` 不是“字段能保存”的同义词：每个 supported 字段都必须在字段消费契约中指向固定 CSS 消费者、视觉层总开关，或 Codex 官方主题的手动导入通道。

字段与投影位于 [`src/capability-schema.mjs`](../src/capability-schema.mjs)，目标 Agent 的唯一注册表位于 [`src/client-registry.mjs`](../src/client-registry.mjs)，持久化和 legacy v1 固定桥接位于 [`src/union-profile.mjs`](../src/union-profile.mjs)。回归测试位于 [`tests/capability-schema.test.mjs`](../tests/capability-schema.test.mjs)、[`tests/client-registry.test.mjs`](../tests/client-registry.test.mjs) 和 [`tests/union-profile.test.mjs`](../tests/union-profile.test.mjs)。

## 文档格式

```json
{
  "schemaVersion": 1,
  "id": "multi-client-skin",
  "name": "三端主题",
  "targetClientId": "workbuddy",
  "values": {
    "appearance.accent": "#E25563",
    "workbuddy.projectHero.position": "right",
    "codex.banner.height": 180,
    "doubao.homeHero.position": "top right",
    "future.vendor.field": {"kept": true}
  }
}
```

字段使用平坦、稳定、与 DOM/CSS 选择器无关的 ID。持久化文档必须至少包含 `{id,name,targetClientId,schemaVersion,values}`；`targetClientId` 必须来自注册表当前的目标 Agent。未来顶层元数据、未知 `values` 字段和其他客户端不适用字段都会保留。新建/保存的用户方案会补齐**当前已知的全部 Union 默认值**，这样将来切换目标 Agent 不需要猜测缺失值；旧的稀疏文档依然可读取并在保存时安全归一化。未来未知字段永远不会被补齐或删除。

每个 `UNION_FIELDS` descriptor 都包含：

| 属性 | 含义 |
|---|---|
| `id` | 永久稳定的字段 ID；发布后不复用旧 ID |
| `type` | `boolean/string/color/number/integer/enum/asset` |
| `defaultValue` | 当前 schema 的安全默认值 |
| `assetSlot` | 图片字段的稳定资源位；非图片字段为 `null` |
| `clients` | 字段概念上适用的 1 到当前注册表中全部目标 Agent |
| `status` | Schema 生命周期：`stable` 或 `candidate` |
| `description` | 面向编辑器和维护者的说明 |
| `version` | 字段首次进入并集 schema 的版本 |
| `group` | 编辑器分组 |
| `constraints` | 枚举、范围、字符数或静态图片安全上限 |
| `legacyV1Path` | 已存在 profile v1 字段的只读映射提示；候选新字段为 `null` |

## v1 字段并集

代码中的 descriptor 是唯一事实源，下面是便于审阅的分组索引。

| 分组 | 稳定字段 ID | 适用客户端 |
|---|---|---|
| 基础 | `advanced.enabled` | 三端 |
| 色彩 | `appearance.variant/accent/surface/ink/contrast` | 三端 |
| 字体 | `typography.codeFont/uiFont` | 三端 |
| 窗口 | `window.opaque` | Codex |
| 语义色 | `semantic.diffAdded/diffRemoved` | 三端 |
| 语义色 | `semantic.skill` | WorkBuddy、Codex |
| 整窗背景 | `background.image/opacity/overlay/blur/position` | 三端 |
| 玻璃 | `glass.enabled/opacity/blur` | 三端 |
| 品牌 | `brand.enabled/displayName/shortMark/logoStyle/iconImage` | 三端 |
| 形状/动效/布局 | `shape.radius`、`motion.preset`、`layout.sidebarWidth` | 三端 |
| Codex | `codex.codeThemeId` | Codex |
| Codex Banner | `codex.banner.enabled/image/opacity/height/width/position` | Codex |
| WorkBuddy 项目 Hero | `workbuddy.projectHero.image/fit/position` | WorkBuddy |
| 豆包首页候选 Hero | `doubao.homeHero.image/fit/position` | Doubao |
| 豆包助手头像候选位 | `doubao.assistantAvatar.image/fit/shape` | Doubao |

图片资源位固定为：

- `background.main`
- `brand.icon`
- `codex.banner`
- `workbuddy.project-hero`
- `doubao.home-hero`
- `doubao.assistant-avatar`

所有已知图片值复用现有静态 PNG/JPEG/WebP 容器、实际解码、尺寸和大小校验。品牌/头像资源是 2 MB、2048 px、4 MP；背景、Banner 与 Hero 是 4 MB、4096 px、16 MP。未知未来字段可以保存 JSON，但不会被当作图片或传给客户端。

## 每个注册 Agent 一个 capability map

`CLIENT_CAPABILITY_MAPS` 为每个适用字段提供：

```json
{
  "fieldId": "workbuddy.projectHero.image",
  "capability": "project-hero",
  "version": 1,
  "status": "supported",
  "description": "已由 WorkBuddy 5.2.6 / 5.3.3 exact adapter、固定编译器与实机项目 Tab 懒加载验证；官方 /projects landing 的节点使用受控本地 WebP CSS content，fit/position 生效，清理后恢复 stock。"
}
```

支持状态的语义：

| 状态 | 编辑器 | 客户端编译 | 存储 round-trip |
|---|---|---|---|
| `supported` | 可编辑 | 消费 | 保留 |
| `pending` | 可执行 Agent 显示“待适配”并禁用；blocked 设计草稿可本机编辑 | 不消费 | 保留 |
| `unsupported` | 显示原因，禁用 | 不消费 | 保留 |

### 字段消费契约

`src/capability-schema.mjs` 的 `CLIENT_FIELD_CONSUMPTION` 是 capability map 的同一份事实源。
它会在模块加载时校验：每个 `supported` 字段恰好拥有至少一个契约条目，`pending` /
`unsupported` 字段不能偷偷声明可消费路径；因此不能出现“编辑器显示已支持、编译器却完全忽略”的漂移。

契约有三种交付通道：

| 通道 | 含义 |
|---|---|
| `runtime-css` | 对应 capability 交集存在时，由 `compileSkin` 的固定、声明式 CSS 规则消费。WorkBuddy 的品牌、控件、项目 Hero，以及 Codex generic-safe 的色板/背景/玻璃在此类。 |
| `runtime-css-gate` | `advanced.enabled`；它是整个视觉层的总开关。其值为 `false` 时编译结果 CSS 必须为空，保持 stock-safe。 |
| `manual-official-import` | 仅 Codex：本地序列化为 `codex-theme-v1:` 文本，由用户在 Codex 的外观设置手动导入。它不会启动、连接、注入或修改 Codex，也不被声称为运行时 CSS。 |

Codex 的 `appearance.variant/contrast`、字体、`window.opaque`、语义色和
`codex.codeThemeId` 目前属于第三类；`appearance.accent/surface/ink` 同时有
generic-safe CSS 与手动官方主题两条路径。服务端的 `includedFieldIds` 同样从该契约
派生，避免主题导出和 capability map 维护两份可能漂移的字段列表。

当前审计边界：

- WorkBuddy：5.2.6 / 5.3.3 exact adapter 已支持 palette、background、glass、brand、controls、project Hero 和 composer avatar 所对应的字段。项目 Tab 懒加载后的官方 `/projects` landing 已实机验证 Hero 的受控本地 WebP CSS `content`、`fit`/`position` 与清理后的 stock 恢复；字体、动效、侧栏宽度等未消费字段标为 `unsupported`。
- Codex：官方主题字段以 `manual-official-import` 明确标注，generic-safe 的 palette/background/glass 以 `runtime-css` 标注；圆角、Banner、品牌、动效和侧栏等依赖当前 exact adapter 或运行时证据的字段标为 `pending`。
- Doubao：已完成 macOS 主包/嵌套 Browser 签名链、静态资源哈希、Framework 和目标白名单审计；但 Pipe/隔离 loopback 传输与实时 DOM 尚未验证，因此 `runtimeStatus=blocked`、`transportVerified=false`、`capabilities=[]`。所有字段仍为 `pending`；已授权用户可以把它们编辑并保存为本机仅设计草稿，但不能预览为注入配置、创建 apply intent、进入 legacy 桥接、排程或启动豆包。

完成一个新版本审计后，原则上只修改对应客户端 capability map 的状态、说明和 map version；字段 ID、存储文档与其他客户端数据不需要迁移。

## 新增 Agent 的扩展顺序

新增一个 Agent 不再依赖在 Schema、授权和排程中复制字符串列表。先在 `src/client-registry.mjs` 声明 ID、显示名、legacy catalog 与排程位置；`UNION_CLIENT_IDS`、服务端发现、授权租约校验、排程 v2 和 Theme Pack 目标集合会从该注册表读取。随后才是有意为之的客户端特有工作：Provider 信任锚、Adapter/运行时探针、该 Agent 的 capability map 元数据与支持策略、必要的新 Union 字段，以及原生菜单 `ClientID`/UI 的显示入口。

新 Agent 初始必须是 `runtimeStatus=blocked`，除非它已经有独立的身份、隔离运行、清理和原版恢复证据。注册表中保留排程位置不代表可执行：未通过验证的 Agent 不会保存自动切换，也不会产生提醒。

## API 函数

### `getEditorFieldsForClient(clientId, options)`

返回该客户端概念上适用的 descriptor，并附加当前值、是否使用默认值、支持状态、说明和 `editable`。默认包含三种支持状态，UI 可用 `includeStatuses` 过滤。

### `compileUnionProfileForClient(profile, clientId)`

返回固定形态的安全投影：

```json
{
  "schemaVersion": 1,
  "sourceSchemaVersion": 1,
  "clientId": "workbuddy",
  "capabilityMapVersion": 1,
  "values": {
    "appearance.accent": "#E25563"
  }
}
```

`values` 只包含该 map 的 `supported` 字段。它不会返回未知字段、其他客户端专属字段、`pending` 或 `unsupported` 字段。

### `normalizeUnionProfile(profile)`

校验当前版本已知字段，同时保留：

- 其他客户端字段；
- 未知 `values` 字段；
- 未知顶层元数据；
- 更高 schemaVersion 中旧运行时无法理解的拓宽字段值。

当前 schemaVersion 中已知字段类型错误会立即失败；高于当前版本的已知字段拓宽值只保存，不编译。

### `updateUnionProfileValues(profile, changes)`

只更新指定字段，其他客户端字段和未知字段保持不变。值为 `undefined` 表示删除显式值、重新使用 schema 默认值。编辑器必须使用该函数或等价的 merge 语义，不能用当前页面字段重建整个 `values`。

### `createUnionProfile(metadata)`

创建包含全部 44 个 v1 默认字段的新并集文档。此函数不会创建或修改旧 profile v1 文件。

## 私有持久化与固定桥接

并集方案保存在历史数据根目录下的新子目录：

```text
~/Library/Application Support/Codex Skin Studio/
  profiles/                 # 原 profile v1，保持原样
  union-profiles/           # 新并集方案
    <id>.json
  union-profile-drafts/     # blocked Agent 的仅设计草稿
    <id>.json
```

`union-profiles` 与 `union-profile-drafts` 都固定为当前用户所有的 `0700` 普通目录，文件固定为单硬链接的 `0600` 普通文件。读取、枚举和覆盖都会拒绝目录 symlink、文件 symlink、hard link、错误所有者、宽松权限和越界文件；保存使用同目录 `wx` 临时文件、`fsync`、原子 `rename` 与目录 `fsync`。每个 store 的单文件上限 20 MB，最多 24 个，总容量 96 MB。两者保存完全相同的完整 Union Profile 数据形状，未知顶层元数据和未知 `values` 字段不丢失；区别只在 store 的可执行边界。

草稿绝不由 `resolveSkin()`、catalog、排程、提醒、`/api/apply-intents`、`unionProfileToLegacyV1()` 或编译器读取。它只为当前 `runtimeStatus=blocked` 的 Agent 提供安全的本地设计保存；当前是豆包。草稿 ID 与可执行方案、旧 profile、内置皮肤和 Theme Pack 共享命名空间，且一旦首次保存便锁定 `targetClientId`，避免一个永久自定义位被改作多套 Agent 皮肤。

`unionProfileToLegacyV1(profile, clientId)` 是唯一运行时桥接：

1. 强制 `profile.targetClientId === clientId`；
2. 调用该客户端 capability map，只取得 `supported` 字段；
3. 只接受 descriptor 中固定的 `legacyV1Path`，再交给现有 `normalizeProfile`；
4. `pending`、`unsupported`、其他客户端字段和未知字段绝不进入 legacy profile；
5. Doubao 的 map 为 blocked，桥接直接返回 `CLIENT_CAPABILITY_BLOCKED`。

WorkBuddy union 方案完成桥接后，仍沿用原有 `mergeFreeBrandOverride` 最后合并免费的名称/图标覆盖，不改变该功能的独立存储与权限边界。

## 本机认证 API

所有接口继续受随机会话 Bearer token、严格 Host/Origin 和 loopback 绑定保护。

### `GET /api/capability-schema?clientId=...`

返回完整 `fields`、所选客户端的 `capabilityMap`，以及带当前值、默认值来源、支持状态和 `editable` 的 `editorProjection`。可选 `profileId` 会读取一个已保存的同客户端并集方案作为投影值；跨客户端请求会被拒绝。

### `GET /api/union-profiles`

返回私有 store 中的并集方案。可选 `clientId` 仅做目标客户端过滤，不会删除或重建其他客户端/未来字段。

### `POST /api/union-profiles`

接受一个并集方案（或 `{profile: ...}` 包装）。保存前先使用服务端已验签的权益快照核对 ID：

- 有效 VIP 可以创建或更新任意合法、无冲突的并集方案；
- `custom_slot_once` 必须同时存在 active grant、`customProfileIds` 快照和完全相同的固定 `binding.profileId`；
- 免费用户以及只购买单套皮肤的用户不能持久化；
- 客户端提交不同 `id`、内置皮肤 ID 或旧 profile v1 ID 均不能绕过。
- `capabilityMap.runtimeStatus !== available` 的目标不能写入可执行 store；必须走下方的草稿接口。
- 已有同 ID 的可执行方案不能改变 `targetClientId`；已存在的同 ID 草稿也会阻止写入。

### `GET /api/union-profile-drafts`

返回仅设计草稿；可选 `clientId` 过滤。响应带 `draftOnly: true`，并且这些方案不在 `GET /api/union-profiles` 中出现。

### `POST /api/union-profile-drafts`

接受完整并集方案或 `{profile: ...}`。服务端仍使用同一份已验签权益与固定 `profileId` 校验：VIP 可保存，永久自定义位只能保存与 grant 完全相同的 ID，免费和单套皮肤授权不能保存。除此之外还必须满足：

- 目标 Agent 当前为 `runtimeStatus=blocked`；已可安全应用的 Agent 必须使用可执行 store；
- ID 不与内置皮肤、Theme Pack、旧 profile 或可执行并集方案冲突；
- 同一个已保存草稿不能用不同 `targetClientId` 覆盖；
- 存储层不会调用 legacy bridge、固定 CSS 编译器、CDP 或任何启动/注入 API。

### `POST /api/union-profile-drafts/:id/promote`

草稿只能在用户提交精确 `{confirm:true}` 后尝试提升。服务端再次验证固定授权、ID 冲突、目标可执行 store 的 24 个/96 MB 容量上限和该目标 Agent 的 `runtimeStatus=available`；未完成实机适配时返回 `DRAFT_PROMOTION_UNAVAILABLE` 并保留草稿。成功时通过无覆盖 hard-link 校验后移除草稿源文件；不会覆盖并发出现的同 ID 可执行方案。异常或进程中断时双链接文件会因 hard-link 防护保持 fail-closed，而非暴露半提升内容。提升不创建 apply intent、不启动也不重启目标应用。用户仍必须在之后单独选择“保存并应用”并完成一次性重启确认。

`POST /api/preview` 通过显式 `unionProfile` 接受未保存的内存方案，不检查持久化权益，因此免费用户可以安全试调；请求不会创建 `union-profiles` 或 `union-profile-drafts` 文件。已保存且授权的可执行并集方案才由现有 `/api/apply-intents` 解析，确认票据仍只保存 `skinId` 和应用指纹摘要，确认时重新读取方案与权益。

## 升级流程

1. 先完成客户端签名、版本、入口、DOM、状态和恢复测试。
2. 若现有字段足够，仅更新对应 capability map：`pending -> supported`，提高 map version 并写清证据。
3. 若确有新视觉值，追加新稳定 ID；不得改变或复用旧 ID。
4. 为新字段补 descriptor、所有适用客户端 map 条目、编辑器与编译投影测试。
5. 未通过审计前保持 `pending`；不能因为页面看起来相似就让编译器消费。
6. profile v1 的迁移应作为单独、显式、可回滚的版本工作完成，不在 capability map 更新时隐式执行。
