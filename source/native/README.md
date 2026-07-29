# 灵妆 LingGlow 原生菜单栏

**灵妆｜AI 助手主题与换肤**是 macOS 专用的 SwiftUI + AppKit 菜单栏客户端。给你的 AI，换上喜欢的样子。它没有网页容器，也不执行任意 JavaScript。

## 构建与发行模式

### 开发 / QA 构建

```bash
./scripts/build_native.sh
```

该命令是本机开发和 QA 用的构建：

- Bundle ID：`local.skin-studio.menubar`（升级兼容标识，品牌改名后保持不变）
- 版本：`2.3.7`
- `LSUIElement=true`，只显示菜单栏图标
- 构建机必须提供 Node.js 22+，用于从 `src/client-registry.mjs` 生成原生 Agent 注册表桥接文件
- 默认只编译当前 Mac 架构，并用 ad-hoc 签名

产物固定为项目根目录的 `灵妆.app`。它可以用于本机启动、测试和视觉验收，但 **不得作为 C 端下载包分发**。若本机已安装并验证 `native/Resources/NodeRuntime/runtime/`，开发构建也会复制该运行时；若没有，开发构建并不代替正式发行的自带运行时保证。

### 正式 macOS 发行

正式 C 端发行必须带有已验证的官方 Node 运行时、Developer ID Application 签名、Apple 公证与 stapling。先准备并验证运行时：

```bash
node scripts/fetch_node_runtime.mjs --install
node scripts/fetch_node_runtime.mjs --verify
```

然后执行发行脚本：

```bash
LINGGLOW_DEVELOPER_TEAM_ID="ABCDE12345" \
CODESIGN_IDENTITY="Developer ID Application: 发行主体 (ABCDE12345)" \
NOTARYTOOL_PROFILE="lingglow-notary" \
./scripts/package_macos_release.sh
```

`LINGGLOW_DEVELOPER_TEAM_ID` 不是可随意填写的标签：它必须是签名证书对应的真实十位 Team ID。发行脚本会拒绝缺失 / 格式错误的值，并在签名后再次确认实际 Team ID 完全相同；原生启动器也会在正式包中复核它。脚本缺少内置运行时、Developer ID、Team ID 或 Notary profile 时会直接拒绝产出，不会把本地 ad-hoc 包伪装成可下载版本。

正式发行脚本默认构建 **Universal 2**（`arm64 x86_64`），使 Apple Silicon 与 Intel Mac 下载同一个已公证安装包，并将已验证的两个 Node 二进制一起签入应用。若确实只面向一种架构，可由发布人员显式设置 `ARCHS`，不要把构建机架构意外带入正式包。最终归档位于 `dist/LingGlow-<version>-macOS.zip`，并在 notary、staple 和 Gatekeeper 评估都成功后才输出。

## 运行方式

点击菜单栏灵妆星光图标会弹出原生面板。图标来自随包的单色 SVG Template Image，会跟随 macOS 菜单栏明暗状态，不是应用位图图标。构建脚本会把 `start.command`、`src/`、`adapters/`、`catalog/`、`public/` 及仅限机器可读的 `qa/*.json` 证据放进 `灵妆.app/Contents/Resources/LingGlowBackend` 后整体签名；视觉 QA 截图不会进入发行包。应用启动时先验证自身签名，只执行包内的 `start.command --background`，不会信任 App 旁边的脚本，也不会打开 Codex 或 WorkBuddy。原生端安全读取：

正式应用图标与菜单栏图标是两套独立资产：`native/Resources/LingGlowAppIcon-Artwork-1024.png` 保留完整彩色原始画面，`native/Resources/LingGlowAppIcon-1024.png` 是经过 84% 视觉占位、圆角遮罩与透明安全边距处理的 Dock 图标源图，`native/Resources/LingGlowAppIcon.icns` 是随包的 macOS 多尺寸资源；`LingGlowMenuBarTemplate.svg` 则保持 18×18 单色 Template Image。需要重建 Dock 图标与 ICNS 时运行 `./scripts/package_app_icon.sh`，脚本会先确定性生成带真实 Alpha 的 1024×1024 PNG，再生成全部尺寸、打包并用系统 `iconutil` 反向读取验收。`build_native.sh` 会复制 ICNS 并写入 `CFBundleIconFile`。

```text
~/Library/Application Support/Codex Skin Studio/studio-session.json
```

这里继续使用旧版数据目录是有意的升级兼容策略；灵妆不会因为产品改名而丢失已有皮肤、授权、排程或免费品牌设置。

它校验文件为当前用户所有、普通非符号链接、权限严格为 `0600`，并使用其中的 Bearer token 访问固定的 `http://127.0.0.1:<port>`。随后还会核对服务返回的 `instanceId`。

换肤和恢复都必须经过“创建一次性 intent → 原生 `NSAlert` 确认 → confirm”三步。关闭弹窗或退出菜单栏 App 不会调用 `/api/shutdown`。

为避免升级后新版菜单栏误连到旧版后台，发行包会生成 `runtime-identity.txt`：它对包内后端、Adapter、Schema、目录、公开资源与 QA 证据逐项做 SHA-256 清单。原生端在启动 Node 前独立校验清单，并把同一身份写入私有 session lock 与 `/api/status`。只有身份完全一致时才复用后台；如果旧版本仍持有正在换肤的会话，新版本会明确拒绝混连，而不会以旧 Schema 编辑或应用新皮肤。

本地界面验收可直接启动 `灵妆.app/Contents/MacOS/SkinStudio --show-popover`；该隐藏参数只让 status-item popover 在启动后自动展开，默认发布行为不变。可执行文件名与 Bundle ID 一样继续保留旧版稳定值，用于 LaunchServices 升级兼容；它们不会出现在产品界面中。

若需要在自动化或辅助功能工具中做截图级 UI 验收，可改用 `灵妆.app/Contents/MacOS/SkinStudio --ui-preview-window`。该开发 / QA 专用参数把**同一份** SwiftUI 根界面显示在一个标准原生窗口中，默认菜单栏模式不会改变；窗口本身不启动、重启、连接、注入或应用任何目标 Agent。

## 三个 Agent 与原生编辑器

客户端选择器和本机状态列表覆盖 **WorkBuddy、豆包、Codex**。豆包在运行时传输与 DOM 选择器完成验证前只显示真实检测状态和候选能力，不伪造皮肤目录，也不会允许应用换肤。

“自定义皮肤编辑器”会按目标 Agent 请求：

```text
GET /api/capability-schema?clientId=workbuddy|doubao|codex
```

可执行 Agent 只允许编辑宿主标记为 `supported` 的字段，`pending` / `unsupported` 字段会说明原因并保持只读。对于明确 `runtimeStatus=blocked` 的 Agent（当前豆包），已授权用户可进入“仅设计草稿”模式编辑 `pending` 字段并保存到独立的 `/api/union-profile-drafts`；它不会进入 `/api/union-profiles`、catalog、排程、apply intent、编译或注入。未知字段和未来 schema 值会原样保留。VIP 或与固定 `profileId` 绑定的 `custom_slot_once` 可以保存及应用可执行方案，或保存同一固定 ID 的不可执行草稿；免费用户可以打开同一个编辑器进行本地预览，但不能保存或应用。非 VIP 同时拥有多个自定义位时，编辑器显示已验证 `profileId` 选择器；每个位独立载入和保存，所有新旧自定义路径都会按 exact `profileId` 校验，拥有 A 位不会授权 B 位。草稿一旦保存会锁定其目标 Agent；未来该 Agent 完成适配后，仍需用户明确确认提升草稿，提升本身不会自动应用或重启。

编辑器预览同样读取这份完整 Union Schema，而不是维护另一套“预览字段”。它在本机将 `profile.values`、宿主返回的全量字段默认值和最小兼容默认值依次解析为三个画板：WorkBuddy 显示免费品牌优先级、侧栏 Tab、项目 Hero、发送/停止控件；Codex 显示侧栏、Composer、代码主题和明确标注“候选仅预览”的 Banner；豆包固定标注“仅设计草图：未启动、未连接、未注入豆包”，显示 Hero、头像和推荐卡片。预览组件不含网络、CDP、进程启动、应用或注入路径，不能因为看到了视觉效果而绕过对应 Agent 的运行时门禁。

WorkBuddy 另外保留一个独立入口：

- **Logo 与显示名称**：永久免费；使用原生文件选择器读取 PNG、JPG、JPEG 或 WebP，图标在本机重新编码并通过 `/api/free-brand` 保存。名称和图标都清空时恢复当前皮肤的默认品牌。

原生端不会把文件路径交给渲染页，也不依赖 WebView、浏览器 Canvas 或 Homebrew 编码器。原图上限 20 MB；完整皮肤图片保存上限 4 MB / 4096 px，品牌图标保存上限 2 MB / 2048 px。

## Dodo Payments 商品目录

授权页只消费本地宿主 `GET /api/products` 发布的商品，不在 Swift 中写死 Product ID。当前协议包含 VIP 月付、VIP 年付、永久单皮肤和永久自定义位四项；四个商品 ID 已切换为 Dodo live mode 正式目录。若签名发行配置、可信授权服务或钥匙串任一不可用，购买与兑换仍保持禁用，不会把 Product ID 当成权益证明。

要开放 live checkout，除当前已完成的正式 Product ID 与 `live_mode` 目录外，还必须部署可信支付 / 授权服务与 HTTPS 账户门户，将发行配置根公钥编入应用，并把签名验证通过的 `release/commerce-public.json` 随正式包签入。仅替换 Product ID，或把未签名 JSON 放进 `release/`，都不会打开购买入口。客户端不会伪造结算或激活成功。

## 皮肤目录

当前目录包含 4 套免费皮肤、3 套旧版 VIP 皮肤，以及 C 罗/葡萄牙、梅西/阿根廷、内马尔/巴西三套跨 Agent VIP Theme Pack。`Dream Portal 测试` 是一套效果明显的免费图片皮肤；卡片会显示 `ART` 标记，用于和纯配色皮肤区分。图片随项目保存在本机，应用时由后端校验路径、文件类型、大小和 SHA-256 后再转换成受控的 WebP data URL，不访问远程素材。豆包目前只显示 Theme Pack 的设计投影，运行时应用仍保持 blocked。

Dream Portal 使用的抽象几何演示图来自 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 `macos/assets/portal-hero.png`，上游 `macos/NOTICE.md` 说明它是该项目原创的无人物演示资产，并与软件一同适用 MIT License。完整归属和许可证文本见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
