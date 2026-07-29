# LingGlow Theme Packs

Theme Pack 是灵妆自有皮肤的生产格式。它解决的是“一次设计，多 Agent 投影”，并且与已有 `catalog/index.json + catalog/skins/*.json` 的 catalog v1 平行存在。正式发布包由独立的 `catalog/theme-packs/index.json` 注册；fixtures 不会自动进入 C 端目录。

- catalog v1 的 7 套现有皮肤、加载 API 和 JSON 均不迁移、不改写。
- Theme Pack 不存三份 `official + advanced` legacy profile。
- 唯一视觉字段来自 `src/capability-schema.mjs` 的 capability union 字段 ID。
- 应用时先生成带严格 `targetClientId` 的 Union Profile，再调用现有 `unionProfileToLegacyV1()`。
- capability map 处于 `blocked` 时不能生成看似可用的配置。目前豆包因此会 fail closed。

## 正式球星灵感 Theme Pack

当前已注册三套 C 端 VIP 皮肤：`C罗灵感·葡萄牙7号星夜`、`梅西灵感·阿根廷10号月光`、`内马尔灵感·巴西10号热浪`。它们采用“球星灵感 + 国家队颜色 + 号码”的商店表达，但画面是原创匿名概念图，不带真实人物脸部、队徽或第三方照片；不得把它们宣传成球员、国家队、足协或品牌的官方联名。

三套正式包均显式写入当前完整 Union Schema 的每一个字段：共享、双端、单端及暂未开放的字段都保留明确值或明确 `null`。这使设计源在新 Adapter 通过验证后不需要反推旧默认值；当前 runtime 仍只消费 capability map 标为 `supported` 的字段，豆包仍维持设计预览和 fail-closed。

商店卡只显示已锁定的名称、简介、颜色和本地艺术标记；它不应把“灵感”省略成“官方同款”。每张卡都是 `tier: "vip"`：免费用户可预览，应用需要有效 VIP 或该卡 ID 的永久单皮肤授权；单皮肤授权首次绑定后不可换绑。

## 两种编辑视图

VIP 皮肤生产侧编辑完整 Union Schema。这样一套产品皮肤可以同时定义：

- 三端共享字段，例如 `appearance.accent`、`background.image`；
- 两端共享字段，例如当前适用于 WorkBuddy 与 Codex 的 `semantic.skill`；
- 单端字段，例如 `workbuddy.projectHero.*`、`codex.*`、`doubao.*`。

用户自定义侧先选择 Agent，再调用 `getThemePackProjectionSchema(clientId)`，只展示字段描述中 `clients` 包含该 Agent 的投影。这里的“只展示”不会删除完整源里的其他 Agent 字段。

`support.status` 仍然决定字段当前能否真正应用：

- `supported`：可以进入当前客户端的固定编译结果；
- `pending`：概念上属于该 Agent，但当前适配器不消费；
- `unsupported`：保留在源中，当前编译器明确不消费；
- `runtimeStatus: blocked`：整个客户端禁止物化或注入。

因此“概念适用”与“当前版本已经验证可应用”是两层信息，不能混为一谈。

## 文件格式

开发样例位于 `catalog/theme-packs/fixtures/cross-agent-sample.json`。它只用于测试，不在 catalog v1 索引中，也不是球星正式皮肤。

正式发布索引使用严格的定义文件哈希锁：

```json
{
  "schemaVersion": 1,
  "kind": "lingglow.theme-pack-index",
  "packs": [
    {
      "id": "cr7-portugal",
      "path": "theme-packs/cr7-portugal.json",
      "sha256": "64 位小写 SHA-256"
    }
  ]
}
```

索引会拒绝重复 ID、重复路径、不安全路径、索引 ID 与定义 ID 不一致、定义文件哈希漂移，以及与 catalog v1 内置皮肤撞 ID。Theme Pack 定义中的每个图片资源仍会再做一层独立 SHA-256 和 WebP 结构校验。

```json
{
  "schemaVersion": 1,
  "kind": "lingglow.theme-pack",
  "id": "cross-agent-sample",
  "name": "跨端主题包样例",
  "description": "一次制作，多 Agent 投影。",
  "tier": "vip",
  "clientIds": ["workbuddy", "doubao", "codex"],
  "preview": {
    "gradientPreset": "sunset",
    "assetId": "main-background"
  },
  "assets": {
    "main-background": {
      "slot": "background.main",
      "path": "assets/dream-portal.webp",
      "sha256": "2154717eedf080ea6ab608638022ecef67116c445e076a55bb02377d1cb415ba"
    }
  },
  "base": {
    "advanced.enabled": true,
    "appearance.accent": "#E25563",
    "background.image": {"assetId": "main-background"},
    "workbuddy.projectHero.fit": "cover",
    "codex.codeThemeId": "codex",
    "doubao.assistantAvatar.shape": "rounded"
  },
  "overrides": {
    "workbuddy": {"appearance.accent": "#D94668"},
    "doubao": {"appearance.accent": "#7C3AED"},
    "codex": {"appearance.accent": "#C241A5"}
  }
}
```

### `base`

`base` 是生产源，不是某个 Agent 的 legacy profile。键必须是当前 Union Schema 已知字段 ID。它可以同时保存单端、双端和三端字段；投影时只挑出适用于目标 Agent 的字段。

未知字段会被拒绝，避免把字段拼写错误静默带入付费皮肤。

### `overrides`

`overrides.<clientId>` 只保存该 Agent 与共享值不同的字段。覆盖字段必须同时满足：

1. `clientId` 已出现在该 pack 的 `clientIds`；
2. 字段存在于 Union Schema；
3. 字段描述的 `clients` 包含该 `clientId`。

例如 `overrides.workbuddy.window.opaque` 会被拒绝，因为 `window.opaque` 当前只属于 Codex。覆盖以字段为单位，优先级高于 `base`。

### `preview`

`gradientPreset` 继续使用 catalog v1 的白名单，因此旧 UI 可以复用现有渐变预览。`assetId` 可以为 `null`，或指向 `assets` 中已经声明并锁定的本地 WebP。

### `assets`

字段值不能直接保存 URL、`data:`、绝对路径或相对文件路径。图片字段只保存：

```json
{"assetId": "main-background"}
```

每个资源声明包括：

- `slot`：必须等于 Union Schema 为图片字段声明的 `assetSlot`；
- `path`：只允许 `catalog/assets/<安全文件名>.webp`；
- `sha256`：64 位小写 SHA-256。

同一张 WebP 可以被不同槽重复声明，但每个声明的 `slot` 必须与引用它的 Union 字段匹配。未使用资源会被拒绝，避免把任意隐藏文件塞进主题包。

加载或物化资源时还会检查：

- catalog 根目录、子目录和文件都不是符号链接；
- 文件是普通单链接文件；
- 大小不超过该 Union 字段的 `maxBytes`；
- SHA-256 与声明一致；
- RIFF/WEBP 结构完整；
- 只有一个 VP8 或 VP8L 主图；
- VP8X 没有动画标记，也不存在 ANIM/ANMF chunk；
- 宽高与总像素不超过该 Union 字段约束。

因此网络图片、Data URL、路径穿越、符号链接、超大文件、哈希漂移、动画 WebP 和伪造扩展名均不会进入最终 Profile。

## 投影与物化 API

实现在 `src/catalog/theme-pack.mjs`。

```js
import {
  getRegisteredThemePack,
  listRegisteredThemePacks,
  loadThemePackRegistry,
  loadThemePackFile,
  projectThemePackValues,
  materializeThemePackUnionProfile,
  materializeThemePack,
} from '../src/catalog/theme-pack.mjs';

const registry = loadThemePackRegistry();
const releasePacks = listRegisteredThemePacks({clientId: 'workbuddy'});
const releasePack = getRegisteredThemePack('cr7-portugal', {clientId: 'workbuddy'});

const pack = loadThemePackFile(
  'theme-packs/fixtures/cross-agent-sample.json',
);

// 设计投影：只筛概念适用字段，不声称当前运行时可注入。
const workbuddyDesign = projectThemePackValues(pack, 'workbuddy');

// 严格目标 Union Profile：先检查 capability map，再验证并嵌入本地资源。
const unionProfile = materializeThemePackUnionProfile(pack, 'workbuddy');

// 最终固定 legacy v1 Profile：内部一定先走上面的 Union Profile。
const legacyProfile = materializeThemePack(pack, 'workbuddy');
```

调用豆包 `materializeThemePack*` 时，当前会抛出 `CLIENT_CAPABILITY_BLOCKED`。`projectThemePackValues()` 仍可用于生产设计和 UI 预览，因为它没有声称皮肤已经能安全应用。

`GET /api/catalog` 会合并 catalog v1 与正式注册的 Theme Pack：WorkBuddy/Codex 返回 7 套旧目录加正式 Theme Pack；豆包只返回 Theme Pack 设计预览卡，并明确带有 `runtimeStatus: "blocked"`、`applySupported: false` 与 `designPreview: true`。服务端 `resolveSkin()` 只允许 WorkBuddy/Codex 物化；豆包不会因为目录可见而绕过运行时封锁。

`loadThemePackFile()` 会在返回前验证 pack 文件和全部资源。直接调用 `validateThemePack()` 只验证声明结构；资源字节会在受信加载或物化时验证，未经验证的字节不会被返回给客户端。

## 新增 Agent 的扩展契约

Theme Pack 模块没有 WorkBuddy、豆包或 Codex 的 `if/switch` 分支。它直接从 capability union 导入：

- `UNION_CLIENT_IDS`；
- `UNION_FIELDS` 与每个字段的 `clients`；
- `getClientCapabilityMap(clientId)`；
- `getUnionField(fieldId)`；
- `unionProfileToLegacyV1()`。

新增 Agent 时只需：

1. 在 capability union 增加 Agent ID，并为共享/专属字段更新 `clients`；
2. 增加对应 capability map 与固定 legacy 映射/适配器；
3. 在需要支持它的 Theme Pack 的 `clientIds` 中加入该 ID，并按需增加 override。

Theme Pack 校验器、生产全字段 Schema、用户投影、资源解析与物化流程不需要增加新的客户端分支。测试还会阻止 `theme-pack.mjs` 引入按客户端硬编码的 `if/switch`。

## 兼容性边界

- 不修改 `catalog/index.json`。
- 不修改 `catalog/skins/*.json`。
- 不修改 `loadBuiltInCatalog()`、`listBuiltInSkins()`、`getBuiltInSkin()` 或 `materializeCatalogProfile()` 的返回形状。
- 正式 Theme Pack 只通过 `catalog/theme-packs/index.json` 发布，定义文件不在索引中就不会进入 C 端目录。
- Theme Pack fixture 不计入 4 套免费 + 3 套 VIP 的 catalog v1 数量。
- C 罗、梅西、内马尔三套正式 VIP Theme Pack 均复用原创静态 WebP 与同一 Union 源，不复制三份 legacy profile。
