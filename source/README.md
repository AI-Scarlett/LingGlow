# 灵妆 LingGlow v2

**灵妆｜AI 助手主题与换肤**是一款运行在 Mac 本机菜单栏的桌面换肤工具：WorkBuddy 已完成精确适配，Codex 当前只开放背景、色板与基础玻璃层的 `generic-safe` 换肤，豆包已加入只读发现与静态 Adapter 审计。豆包尚未开放换肤，Codex 也不会被宣传为已完成精确界面适配。给你的 AI，换上喜欢的样子。它提供可点击的皮肤库、本地预览、自定义工作室和七日换肤提醒，同时把应用验签、版本兼容、重启确认与恢复原版放在同一套安全流程里。

它不是 GPT，不会创建或调用另一个 AI，也不会修改模型。**打开灵妆只会打开本地工作台，不会启动、退出或重启任何目标 Agent（Codex / WorkBuddy / 豆包）。** 只有你在最终确认框中点击“确认切换并重启”后，已通过适配验证的所选应用才会正常退出并重新打开。

品牌名称固定为中文 **灵妆**、英文 **LingGlow**，完整展示名为 **灵妆｜AI 助手主题与换肤**，Slogan 为 **给你的 AI，换上喜欢的样子。** 彩色应用图标源文件位于 [`native/Resources/LingGlowAppIcon-1024.png`](native/Resources/LingGlowAppIcon-1024.png)，macOS 应用资源位于 [`native/Resources/LingGlowAppIcon.icns`](native/Resources/LingGlowAppIcon.icns)，独立的菜单栏 Template Icon 位于 [`native/Resources/LingGlowMenuBarTemplate.svg`](native/Resources/LingGlowMenuBarTemplate.svg)。

## 现在能做什么

- 在 Codex、WorkBuddy 与豆包之间切换目标；豆包当前明确标为“仅设计草稿”，不会启动、重启、注入、进入排程或出现在可应用皮肤库中。VIP 或已绑定自定义位可把完整设计安全保存到本机，待未来完成实机适配后再由用户显式提升。
- 使用 4 套免费内置皮肤：Dream Portal 测试、石墨专注、海风浅蓝、青玉静谧。
- 预览 3 套 catalog v1 VIP 皮肤：极光玻璃、落日工坊、紫雾星云。
- 预览 3 套由统一 Theme Pack 生成的原创球星灵感 VIP 主题：C罗灵感·葡萄牙7号星夜、梅西灵感·阿根廷10号月光、内马尔灵感·巴西10号热浪；WorkBuddy/Codex 可物化，豆包当前只显示设计预览。
- VIP 或已兑换一个“自定义位”的用户，可用本地图片、颜色、玻璃透明度、模糊和圆角制作对应的自定义皮肤；WorkBuddy 项目 Hero 有独立选图与预览位。未完成运行时适配的 Agent 只能保存不可执行设计草稿，绝不自动转为可应用皮肤。
- 每台 Mac 在第一次解析本机权益时自动获得一次 **7 天免费 VIP 试用**：试用期间可使用全部 VIP 功能，菜单栏会显示剩余时间与到期时间。它不是 Dodo 订阅、授权码或伪造租约；记录以私有 `0600` 文件原子保存并保留最高已观察时间，普通“移除授权”或“停用设备”不会重置它。
- 已保存的 Codex 自定义皮肤可在原生编辑器中导出并复制 `codex-theme-v1:` 官方主题字符串，再由用户在 Codex 的外观设置中手动导入；导出不启动、不连接、不重启、不注入或修改 Codex，背景图、Banner 与布局字段不会混入官方主题文本。详情见 [`docs/CODEX-OFFICIAL-THEME-EXPORT.md`](docs/CODEX-OFFICIAL-THEME-EXPORT.md)。
- 所有用户都可免费替换 WorkBuddy 的显示名称和品牌图标；该设置仅保存在本机，不占用 VIP 或自定义位。
- VIP 可为注册表中的 Agent 配置周一到周日的皮肤；当前只有通过运行时验证的 Agent 会保存可执行安排并在当天首次检测到使用时提醒，由用户决定现在切换、稍后提醒或今天跳过。
- 一键恢复官方原版，并在每次切换前重新检查应用签名、版本和兼容性。

六套纯配色皮肤和三套球星灵感 Theme Pack 是本项目原创视觉方案；球星灵感主题不使用真实肖像、足协/俱乐部徽标或第三方照片，也不表示球员、国家队、足协或品牌的认可与合作。Dream Portal 测试皮肤使用 Codex Dream Skin 项目在 MIT License 下发布的原创抽象几何演示图，不包含人物、品牌标志或远程素材；完整归属见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 快速开始

1. 已公证的正式发行包会把本地服务、Adapter、皮肤、界面资源和经过 SHA-256 校验的官方 Node 运行时（Apple Silicon 与 Intel 各一份）一并封入签名包，因此普通用户不需要另外安装 ChatGPT、Codex 或 Node.js。源码目录中用 `./scripts/build_native.sh` 生成的 `灵妆.app` 是本机开发 / QA 构建，不是可分发的正式版本。
2. 双击 `灵妆.app`。源码目录中的 `start.command` 只保留给开发与诊断使用；启动后只在菜单栏显示灵妆星光图标。
3. 点击灵妆图标，在“皮肤”页选择 **Codex**、**WorkBuddy** 或 **豆包**；豆包在验证完成前只能本地预览。
4. 选择皮肤卡片。带本地图片的皮肤会直接显示经完整性校验的真实素材缩略图，纯配色皮肤显示颜色预览。
5. 点击“应用”后，灵妆会先完成安全检查并生成一次性操作。阅读原生确认框中的应用、皮肤和重启影响。
6. 只有点击“确认切换并重启”，目标应用才会正常退出、以受控 Pipe 模式重新打开并加载皮肤。
7. 想回到官方界面时，在同一页面点击“恢复原版”，再完成同样的一次性确认。

关闭弹窗不会退出菜单栏应用；在“设置”页点击“退出灵妆”才会关闭菜单栏客户端。退出客户端不会调用 `/api/shutdown`，因此不会拆除正在使用的皮肤会话或登录项持有的本地服务。

## 开发构建与正式 macOS 发行

开发构建与面向 C 端的正式发行是两条明确分开的路径：

- `./scripts/build_native.sh`：要求构建机有 Node.js 22+，默认只编译当前 Mac 架构并使用 ad-hoc 签名。它只用于本机开发、自动化测试和界面验收，不能作为下载包分发。
- 正式发行：必须使用 `./scripts/package_macos_release.sh`。脚本默认构建 Universal 2、要求内置 Node 运行时完整通过校验、使用 Developer ID Application 签名、提交 Apple Notary、staple 后再由 Gatekeeper 验收。

正式发行前先准备受审计的运行时；安装器只接受 `native/Resources/NodeRuntime/manifest.json` 中固定的 `nodejs.org` 文件名和 SHA-256，分别校验 Apple Silicon 与 Intel 二进制：

```bash
node scripts/fetch_node_runtime.mjs --install
node scripts/fetch_node_runtime.mjs --verify
```

然后以证书所属的真实十位 Team ID 发行。`LINGGLOW_DEVELOPER_TEAM_ID` 必须与 Developer ID 证书中的 Team ID 完全一致；脚本和应用内启动器都会校验这一点：

```bash
LINGGLOW_DEVELOPER_TEAM_ID="ABCDE12345" \
CODESIGN_IDENTITY="Developer ID Application: 发行主体 (ABCDE12345)" \
NOTARYTOOL_PROFILE="lingglow-notary" \
./scripts/package_macos_release.sh
```

这还不是自动开放收费的开关。当前四个 Dodo Product ID 全部是 **test mode**：即使完成 Developer ID 签名和公证，正式包也必须继续禁用 live checkout。要开放真实购买，必须另行创建并核对四个 live Product ID、把完整商品目录切换为 `live_mode`、部署可信授权服务，并生成由发行配置根密钥签名的 `release/commerce-public.json`；示例文件或单独把 Dodo API 环境改成 live 都不会生效。详情见 [原生发行说明](native/README.md)、[内置 Node 运行时](native/Resources/NodeRuntime/README.md) 与 [桌面端可信购买桥](docs/DESKTOP-COMMERCE-BRIDGE.md)。

## 免费与三种购买权益

除下表的长期权益外，每台 Mac 首次解析本机权益会获得一次独立的 7 天免费 VIP 试用。有效的 VIP 订阅优先；若用户同时拥有单套皮肤或自定义位永久授权，试用期间会保留这些真实绑定，到期后立刻回落为对应的永久权益。试用不是第四种 Dodo 商品，也不会生成、伪装或替代签名租约。

| 能力 | 免费 | 单套皮肤永久授权 | 单个自定义位永久授权 | VIP 月/年订阅 |
|---|---:|---:|---:|---:|
| 已验证 Agent 基础换肤 | ✓ | ✓ | ✓ | ✓ |
| 4 套免费皮肤 | ✓ | ✓ | ✓ | ✓ |
| 6 套 VIP 皮肤预览 | ✓ | ✓ | ✓ | ✓ |
| 应用付费内置皮肤 | — | 仅绑定的一套 | — | 全部 |
| 本地图片自定义皮肤 | 可试调、可预览 | — | 仅绑定的一个位 | 不限已授权位 |
| 已验证 Agent 七日排程 | — | — | — | ✓ |
| WorkBuddy 名称 / 品牌图标 | ✓ | ✓ | ✓ | ✓ |
| 安全检测与恢复原版 | ✓ | ✓ | ✓ | ✓ |

当前版本已经把 VIP 月付、VIP 年付、单套皮肤永久授权和自定义位永久授权四个 Dodo 商品集中到 `src/products.mjs`，Web 与原生界面可从 `GET /api/products` 共用同一份公开目录；同时已实现三类权益的 Ed25519 签名租约、严格门禁和旧版 VIP 授权兼容。用户提供的四个 Product ID 已现场确认全部属于 **Dodo test mode**，live checkout 均不存在，因此只能联调，不能对用户收费。可信 Checkout/Webhook/License/PostgreSQL 服务代码仍须独立部署；在新增四个 live Product ID、切换完整目录为 `live_mode`、内置发行配置公钥并打包一份验签通过的 live `release/commerce-public.json` 前，产品接口会明确显示 `unconfigured` 或 `test`，购买 / 兑换 URL 为 `null`，不会伪造“已购买”或内置万能 VIP。正式服务端合约、不可换绑约束和退款/设备解绑规则见 [`docs/DODO-ENTITLEMENTS.md`](docs/DODO-ENTITLEMENTS.md)。商业发布前还要完成 Developer ID 签名、公证、更新渠道，以及真实发行方的隐私政策、用户条款和支持联系方式。

自定义皮肤后端现使用全量能力并集文档 `{id,name,targetClientId,schemaVersion,values}`。`src/client-registry.mjs` 是 Agent ID、Schema、授权与排程的单一来源；原生菜单栏应用的 `ClientID` 桥接文件也会在构建时从它自动生成，避免未来新增 Agent 时服务端与原生选择器分叉。保存后的用户方案会带齐全部已知 Union 默认字段，目标切换时不会丢失另一个 Agent 的配置。认证接口 `GET /api/capability-schema?clientId=...` 返回字段、客户端 capability map 和编辑器投影；可执行方案使用 `GET/POST /api/union-profiles`，尚未运行时适配的 Agent 使用完全隔离的 `GET/POST /api/union-profile-drafts`。免费用户可以通过 `POST /api/preview` 的 `unionProfile` 做纯内存试调，但不会产生文件；VIP 可以创建/更新，永久自定义位只能写入签名租约中已绑定的固定 `profileId`，客户端换一个 ID 会被拒绝。草稿与可执行方案共享 ID 命名空间，已保存后目标 Agent 也会锁定；草稿永不进入 catalog、resolve、排程、apply intent、legacy 桥接或注入。只有该 Agent 的 `runtimeStatus` 变为 `available` 后，用户可显式确认提升草稿；提升本身不会创建 apply intent 或重启目标应用。运行时只把目标客户端标为 `supported` 的字段桥接到旧 profile v1。完整格式和安全边界见 [`docs/CAPABILITY-UNION-SCHEMA.md`](docs/CAPABILITY-UNION-SCHEMA.md)。

## 免费 WorkBuddy 品牌覆盖

WorkBuddy 的显示名称和品牌图标属于免费基础能力，不经过 VIP 或自定义位门禁。图标仅接受本机选择并嵌入的静态 PNG、JPEG 或 WebP；后端限制为 2 MB、2048 px、4 MP，并复核容器和实际解码。配置保存在私有的 `free-brand.json`，不会修改 WorkBuddy 安装包，也不能携带 CSS、JavaScript、SVG、文件路径或网络 URL。

本地菜单栏客户端使用认证 API `GET /api/free-brand?clientId=workbuddy` 读取配置，并用 `POST /api/free-brand` 保存 `{clientId, displayName, iconImage}`。把名称和图片都设为 `null` 会删除覆盖文件；可以直接选择“保存并重新应用”，仍须经过一次性重启确认。重新应用后恢复该皮肤自身的名称和图标，未设置品牌的皮肤则恢复 WorkBuddy 原标识。品牌覆盖只合并这两个身份字段，皮肤原有的 `shortMark`、`logoStyle`、颜色和布局不会被请求改写。

## 七日换肤提醒

排程 v2 为每个注册 Agent 保留一周七天的位置，并自动把旧的 Codex/WorkBuddy 双端计划迁移为 v2。提醒遵循以下原则：

- 每个应用每天最多提醒一次。
- 只在检测到目标应用正在使用时提醒，不会按时间强制打开应用。
- 未完成运行时适配的 Agent 不会保存可执行安排，也不会弹出重启提醒；它的七天位置只为后续通过验证后无损启用而保留。
- 用户可以选择“现在切换”“1 小时后”或“今天跳过”。
- 选择“现在切换”只会准备一次性重启确认；用户取消、确认后启动失败或注入失败都不会消耗当天提醒。只有目标应用成功完成确认换肤后，服务才原子写入“今日已处理”。
- “1 小时后”会写入私有排程状态，重启灵妆服务后仍会在到期前保持静默。
- 可选开启“随登录启动提醒服务”；默认不安装，只有用户主动开启才会写入由本工具管理的 LaunchAgent。
- 关闭随登录提醒时只删除本工具创建且重新校验通过的 LaunchAgent，不覆盖或删除其他登录项。

## 当前兼容状态

| 应用 | 当前实机版本 | 兼容级别 | 当前能力 | 验证情况 |
|---|---|---|---|---|
| WorkBuddy | `5.2.6` / `5.3.3` | `exact` | 全窗背景、左右区域、卡片、Tab、按钮/发送/停止、品牌、项目 Hero、输入区头像 | 两个版本均完成真实重启、五个顶层 Tab、More 菜单、全局背景、品牌、控件、Hero、清理和 stock 恢复验证；5.3.3 的官方 `/projects` landing 已实机确认受控本地 WebP、`fit`/`position` 生效，ASAR 前后哈希一致 |
| Codex | `26.707.91948` | `generic-safe` | 背景、色板、基础玻璃 | 已通过官方签名与静态能力检查；当前版本尚未完成真实重启换肤验证 |
| Doubao | `2.12.7` / `2.19.9` 静态快照 | `blocked` | 无 | 已锁定主/嵌套签名、Chromium、Extension、资源与 target 白名单；未经隔离重启验证传输 |

这里的 `generic-safe` 不是“完全适配”。它表示版本已经超出已登记的精确 Adapter，但基础结构信号仍满足安全下限，因此只开放背景、色板和玻璃层，自动关闭 Banner、侧栏宽度和构建敏感布局。当前 Codex 版本不会被宣传为已经实机验证。

兼容结果分为三档：

- `exact`：应用指纹与已验证 Adapter 完全匹配，只开放 Adapter 明确声明的能力。
- `generic-safe`：版本发生变化但基础信号仍在，仅开放背景、色板和基础玻璃。
- `blocked`：签名、发布者、入口或必需能力不通过，不允许启动皮肤模式。

## 安全边界

灵妆的高级换肤不是替换安装包，而是临时控制官方 Electron 界面的显示层：

- 不解包重打、不覆盖、不修改目标应用的 `app.asar`。
- 只使用进程继承的 `--remote-debugging-pipe`，不开放 CDP TCP 调试端口，也没有 TCP 回退。
- 每次应用或恢复前重新校验 Bundle ID、官方 Team ID、代码签名、sealed resources、版本、ASAR 指纹和页面能力。
- 皮肤是严格校验的声明式数据，经固定编译器生成受控 CSS；皮肤包不能携带任意 CSS、JavaScript 或远程 URL。
- 本地图片只接受静态 PNG、JPEG 或 WebP data URL，并检查容器、动画标记、实际解码、尺寸和大小上限；品牌图标使用更严格的 2 MB / 2048 px 上限。
- 不读取对话正文、提示词、输入框、终端内容、Cookie、账号、项目文件或应用启动参数中的敏感值。
- 本地工作台只监听随机 `127.0.0.1` 端口，API 使用随机会话令牌和严格 Origin / CSP 校验。
- 应用或恢复都需要短时效、单次使用且绑定应用指纹的确认操作；确认期间应用若更新，操作会失效。

完整安全说明见 [SECURITY.md](SECURITY.md)，升级与 Adapter 机制见 [docs/UPGRADING.md](docs/UPGRADING.md)，Doubao 零能力第一阶段见 [docs/DOUBAO-PHASE-1.md](docs/DOUBAO-PHASE-1.md)。

## 恢复原版

推荐在灵妆中选择目标应用，然后点击“恢复原版”并确认。工具会正常退出目标应用，再以无调试参数方式重新打开。

工作台不可用时可使用 CLI：

```bash
node src/cli.mjs restore-stock codex
node src/cli.mjs restore-stock workbuddy
```

不方便使用终端时，也可以双击 `恢复Codex原版.command` 或 `恢复WorkBuddy原版.command`。恢复不会删除对话、项目、登录状态或目标应用配置；如果应用无法正常退出，工具会停止并报告错误，不会默默强杀。

## CLI 与测试

`start.command` 会依次寻找经过官方签名验证的 ChatGPT / Codex 内置 Node、`CODEX_SKIN_STUDIO_NODE` 指定的本机 Node，以及 PATH、Homebrew 或 MacPorts 中的系统 Node.js；每个候选都必须实际通过 Node.js 22+ 检查才会被采用。它不会把 WorkBuddy 的 Electron 当成 Node。执行 ChatGPT / Codex 应用包中的独立 `cua_node` 二进制不等于启动对应应用，也不会打开它们的窗口。

```bash
# 查看 Codex、WorkBuddy 与 Doubao 的签名、版本和兼容级别；不会重启应用
node src/cli.mjs doctor

# 打开本地工作台；不会启动目标应用
node src/cli.mjs dashboard --open

# 恢复指定应用的官方界面；会重启该应用
node src/cli.mjs restore-stock codex
node src/cli.mjs restore-stock workbuddy

# 不启动目标应用的单元与本地服务测试
npm test

# WorkBuddy 实机集成测试；会真实退出、重启、换肤并恢复 WorkBuddy
npm run test:workbuddy
```

运行 `npm run test:workbuddy` 前请保存 WorkBuddy 中尚未提交的内容。Codex 的隔离集成脚本保留为 `npm run test:integration`，但现在必须在单独 macOS 用户或一次性 VM 中提供两项显式风险确认，并使用 `CODEX_ELECTRON_USER_DATA_PATH`、临时 `CODEX_HOME` 与继承 Pipe；当前任务没有执行它，26.707.91948 仍不能计入 exact 已验证状态。

## 本地数据与卸载

默认数据目录：

```text
~/Library/Application Support/Codex Skin Studio/
```

为保证从旧版升级后不丢失皮肤、授权和排程，灵妆继续读取这个历史数据目录；产品改名不会迁移或清空其中内容。

其中 `profiles/` 继续保存旧 profile v1，`union-profiles/` 保存可执行的三端能力并集方案，`union-profile-drafts/` 只保存 blocked Agent 的不可执行设计草稿；另有免费 WorkBuddy 品牌覆盖、周计划、提醒状态、许可证文本和运行期私有锁。并集目录为 `0700`、保存文件为 `0600`，原子覆盖并拒绝 symlink/hard link；草稿提升使用同一私有数据根内“无覆盖链接校验 → 移除源文件”的 fail-closed 移动，不会覆盖另一个并发创建的可执行方案。它不会复制 Codex、WorkBuddy 或 Doubao 的登录数据。

卸载前先恢复曾被应用过皮肤的目标 Agent 的原版界面，并在设置中关闭“随登录启动提醒服务”。随后删除本工具文件夹和上述数据目录即可；不要删除 Codex、WorkBuddy 或豆包自己的 Application Support 或 `~/.codex`。

## 与 Codex Dream Skin 的关系

本项目吸收了 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 中值得保留的消费体验，例如选图、皮肤库、快速切换和恢复入口，但没有照搬它的 TCP 调试端口、任意脚本注入或脆弱选择器方案。免费的 Dream Portal 测试皮肤复用了上游 MIT 授权的抽象演示图，以验证图片背景链路；详细归属见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。完整比较、已吸收功能和上游风险见 [Dream Skin 对比与产品化决定](docs/DREAM-SKIN-COMPARISON.md)。

更多内部设计见 [架构说明](docs/ARCHITECTURE.md)；三端字段如何共存、按客户端投影和向前兼容，见 [能力并集 Schema v1](docs/CAPABILITY-UNION-SCHEMA.md)。

## GitHub 远程皮肤目录

灵妆 2.2.0 起支持“远程发现、按需下载、本地校验安装”。安装包不再携带全部大图，只保留运行时、Legacy 兼容小资源和一套离线兜底主题。客户端从官方 GitHub `catalog/v1/index.json` 显示名称、样式预览、明暗模式、大小和 Agent 适配；用户点击下载后才读取单套 `.lingglow-skin.json`，校验包与每张 WebP 的 SHA-256 后原子安装。

架构、安全边界、目录地址和发布顺序见 [GitHub 远程皮肤目录 v1](docs/REMOTE-SKIN-CATALOG.md)。用户使用方式和皮肤制作 Skill 将同步发布到公开仓库，皮肤更新不再要求用户升级整个 App。

## License

MIT
