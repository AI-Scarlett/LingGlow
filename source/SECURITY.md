# 灵妆安全模型（v2）

灵妆（LingGlow）v2 的目标不是把 CDP 变成通用插件平台，而是把“换肤”压缩成一组可审查、可降级、可恢复的视觉能力。它支持 Codex 与 WorkBuddy，但不会修改两个应用的安装包，也不会接受主题作者提供的可执行代码。

## 内置信任锚

客户端身份由代码中的 `client provider` 策略固定，不由 Adapter、皮肤包或 Dashboard 请求决定。

| 客户端 | Bundle ID | 发布者 Team ID | 页面类型 |
|---|---|---|---|
| Codex / ChatGPT | `com.openai.codex` | OpenAI `2DC432GLL2` | `app://-/index.html` |
| WorkBuddy | `com.workbuddy.workbuddy` | Tencent `FN2V63AD2J` | 已验证 `app.asar` 内 `renderer/index.html` 的规范 `file:` URL |

在读取前端信号或启动应用前，Provider 会检查 Bundle ID、Team ID、`codesign --verify --deep --strict`、sealed resources、主可执行文件、`app.asar` 身份与 SHA-256。Adapter 即使声明其他 Bundle ID 或 Team ID，也无法扩大信任范围。

应用发现在固定候选位置、对应环境变量和 Spotlight 结果中进行；路径本身不是信任依据。所有后续操作都使用验签后记录的真实路径与不可变指纹。

## 声明式皮肤边界

内置 catalog 与自定义方案都经过严格 schema。主题作者不能提供：

- 任意 CSS 或 JavaScript；
- `http:`, `https:`, `file:`, `data:`, `javascript:` 等 URL 字段；
- SVG、HTML、字体文件、可执行文件或压缩包；
- DOM 选择器、CDP 方法、目标页面 URL 或磁盘路径。

内置 catalog 只允许白名单颜色、数值、枚举、客户端列表和固定渐变预设；随包图片只能通过固定 `assets/` 相对路径、大小和 SHA-256 摘要声明，不能携带网络 URL。用户图片只接受本地嵌入的静态 PNG、JPEG 或 WebP data URL。后端验证各格式容器、拒绝 APNG 与动态 WebP、限制 4096 px、16 MP、4 MB，并用 macOS ImageIO 实际解码、复核尺寸。免费 WorkBuddy 品牌图标使用更严格的 2048 px、4 MP、2 MB 上限。SVG、文件路径和网络 URL 不会进入方案。

免费品牌覆盖只允许 `displayName` 与 `iconImage` 两个身份字段。配置写入当前用户私有的 `free-brand.json`，认证 API 不设权益门禁；服务端仅在解析 WorkBuddy profile 时合并这两个字段，不接受选择器、CSS、JavaScript、短标形状或其他皮肤字段。两项清空时删除覆盖文件并恢复皮肤自身或 WorkBuddy 原标识。

固定编译器只把白名单字段转换为受控 CSS。皮肤不能改变编译器，也不能携带运行时代码。

## CDP 传输与目标限制

高级换肤只使用 Chromium `--remote-debugging-pipe`：

- 不监听 TCP 端口；
- 不访问 `/json/list`；
- 不存在 WebSocket/TCP 回退；
- Pipe 只存在于灵妆派生的已验签客户端进程与当前控制器之间；
- 灵妆关闭 Pipe 后，不会留下可被局域网扫描的调试端口。

CDP 本身具有读取页面与执行代码的能力，因此 v2 不向 Dashboard 或皮肤包暴露通用 `Runtime.evaluate`。控制器只执行固定的结构探针、固定的样式安装/检查/清理脚本，并且不读取对话正文、输入值、Cookie、localStorage、IndexedDB、剪贴板或终端内容，也不安装键盘、鼠标或网络监听器。

注入脚本在任何 DOM 写入前都要求：

1. 当前文档是顶层 frame；
2. 去除 query/fragment 后的 URL 与已验证目标 URL 精确相同；
3. 运行时结构探针通过；
4. 当前能力在兼容级别与 Adapter 能力交集中。

非授权导航、子 frame、远程页面或结构不匹配页面不会获得样式。

### Codex 探针

Codex 只接受 `app://-/index.html`，并检查单一 `#root`、Electron 根标识、主区域、设计令牌，以及在启用 Composer 能力时对应的语义标识。

### WorkBuddy 探针

WorkBuddy 的目标不是硬编码安装路径。Provider 从已验签 App 的实际 `app.asar` 路径与固定相对路径 `renderer/index.html` 生成规范 `file:` URL。运行时还要求单一 `#root`、`data-application-name="workbuddy"`、Electron desktop/macOS 标识、版本匹配和 `--vscode-*` 设计令牌。

WorkBuddy 当前无论处于 `exact` 还是 `generic-safe`，都只开放：

- `background`
- `palette`
- `glass`

它不开放 Banner、Composer、侧栏宽度、控件动效或布局重排。

## 兼容级别与最小权限

- `exact`：Bundle/Team、version、build、ASAR SHA-256、静态信号与运行时探针全部匹配，只开放 Adapter 明确列出的能力。
- `generic-safe`：版本或哈希未知，但官方签名、目标入口、产品标识和基础设计信号仍完整；只开放 `background`、`palette`、`glass`。
- `blocked`：身份、签名、入口或必需信号任一失败，不启动皮肤模式。

`generic-safe` 不是精确适配，也不会继承旧版的 Banner 或布局能力。未知版本永远不会因为“看起来像 Electron”而自动获得更多权限。

## 重启确认与 Apply Intent

打开 Dashboard、浏览皮肤、预览、收到日程提醒或运行 Doctor 都不会启动、退出或重启目标应用。应用皮肤与恢复原版必须经过一次性 Apply Intent：

- ID 由 32 字节随机数生成，具有 256-bit 随机性；
- 默认有效期 2 分钟，最多同时保存 128 条；
- 只存在于当前服务内存，不写入磁盘；
- 绑定客户端、皮肤、操作类型、影响说明和应用不可变指纹；
- 原始应用指纹只以进程内随机 HMAC 摘要保存；
- 不在 intent 中保存图片或完整 profile，确认后重新按 `skinId` 解析；
- 确认时重新验签、重新计算指纹、重新检查 VIP 权益和皮肤是否仍存在；
- 成功确认前先删除 intent，保证单次消费；过期、取消、换客户端或应用更新都会使其失效。

旧的直接重启 API 返回 `410`。即使周计划建议“现在切换”，也只会进入上述确认流程，永不静默重启。

## 进程与参数隐私

WorkBuddy 的辅助进程可能使用同一 Electron 可执行文件，并在参数中携带会话信息。进程发现因此只认可两种完整、精确的主进程命令：

1. 只有已验证主可执行文件路径；
2. 同一路径后仅有 `--remote-debugging-pipe`。

其他命令一律忽略。服务与 Dashboard 只返回 PID 和 `stock`/`pipe` 分类，不返回、记录或序列化完整 argv。日志也不记录对话、提示词、项目路径、终端输出、账号数据或 API token。

## Dashboard 安全

本地工作台：

- 只绑定 `127.0.0.1` 随机端口；
- 每次启动生成 32 字节随机会话令牌；
- 令牌通过 URL fragment 交给页面，页面读取后从地址栏移除，不进入 HTTP 请求日志；
- API 使用 Bearer token，并用常量时间比较；
- Host 必须精确等于当前 loopback 地址；Origin 存在时必须精确匹配；不启用 CORS；
- 使用严格 CSP、`frame-ancestors 'none'`、`object-src 'none'`、`no-referrer`、`nosniff`、权限策略与 `no-store`；
- 修改操作只接受认证后的 JSON POST，并限制请求体大小；
- 会话锁、许可证和用户数据按当前用户收紧为 `0600`/`0700`，并拒绝不安全符号链接。

“退出工作台”会先清理灵妆管理的皮肤会话，再关闭服务并移除运行期锁。

## Free / VIP / 永久资源权益

未提供权益租约时始终解析为 Free。租约接口采用 Ed25519 离线验签，并检查严格 schema、`audience=codex-skin-studio`、签发/生效/过期时间及适用客户端列表。运行时只接受注入的 Ed25519 公钥，明确拒绝私钥材料和其他算法。schemaVersion 2 可携带月付 VIP、单套皮肤和单个自定义位三类 grant；旧 schemaVersion 1 VIP 令牌仅作为兼容输入。

当前发行包**尚未配置正式发行公钥，也未部署 Dodo Payments 激活与吊销服务**。因此当前版本不能被描述为已经可购买；在未配置公钥时，授权入口会明确失败，不存在内置万能 VIP。权益私钥未来也只能位于发行服务端，不能进入客户端或仓库。

四个 Dodo Product ID 集中在 `src/products.mjs`，并通过认证的 `GET /api/products` 同时供 Web 和原生界面读取。Product ID 是公开路由标识，不是授权凭证；把 Product ID、offerType 或 `valid=true` 写入本地状态都不能产生权益。客户端只接受可信服务签发的 Ed25519 租约。

支付配置采用失败关闭：`DODO_PAYMENTS_API_KEY`、`DODO_PAYMENTS_WEBHOOK_KEY`、显式 test/live 环境、持久数据库、KMS/HSM 签名密钥引用和 HTTPS Return URL 任一缺失时，产品接口报告 `unconfigured`，checkout/redemption 不可用。桌面服务默认使用空配置，且只保留配置状态，不保留任何注入的 secret 值。Webhook 必须针对原始字节验证 `webhook-id`、`webhook-signature`、`webhook-timestamp`，再以 event ID 幂等处理；禁止生产环境使用未验签解析。

VIP grant 控制全部付费 catalog、自定义方案、七日排程与登录提醒；`skin_once` 只开放签名租约绑定的一个 `skinId`；`custom_slot_once` 只开放绑定的一个 `profileId`。退款或撤销会锁定使用权但保留 binding，设备停用不得改写 grant。免费用户可以预览，但不能通过直接 API 绕过服务端门禁。完整服务端不变量见 [`docs/DODO-ENTITLEMENTS.md`](docs/DODO-ENTITLEMENTS.md)。

## 七日计划、提醒与登录代理

周计划按 Codex/WorkBuddy、时区和周一至周日分别保存，计划与每日提醒状态使用严格 schema、原子写入、私有权限和符号链接防护。提醒只在目标应用已运行时出现，每个应用每天最多认领一次。

提醒可以打开 Dashboard、稍后提醒或今天跳过；它本身不能执行换肤。用户仍需在 Dashboard 中创建并确认 Apply Intent。

登录提醒代理：

- 默认关闭；
- 只有有效 VIP 用户明确开启时才能安装；
- 写入当前用户 `~/Library/LaunchAgents/local.skin-studio.reminder.plist`；
- 不调用 `launchctl`，不会立即启动服务或重启任何客户端；下次登录时才生效；
- 删除始终允许，不因 VIP 失效而锁住；
- 只删除内容、所有者、inode 与权限重新校验后确认由本工具管理的文件；已有陌生或不安全文件时拒绝覆盖/删除。

## 当前验证快照（2026-07-16）

| 客户端 | 版本 / Build | ASAR SHA-256 | 级别 | 证据边界 |
|---|---|---|---|---|
| Codex | `26.707.91948` / `5440` | `b5da51e5df6e996076e4cb19045cec46dd4c08cf61c19cdbc5cb426b8413b73c` | `generic-safe` | 官方签名与静态基础信号满足；当前版本尚未完成真实重启换肤验证，不算精确适配 |
| WorkBuddy | `5.2.6` / `5.2.6` | `c5eef2ddf63f8da45b5c268a0d9b49dc51d5652690da453721281977613ed0c5` | `exact` | 已真机完成正常退出、Pipe 启动、规范 `file:` 目标发现、变量注入、清理、无调试参数恢复，并确认前后 ASAR 哈希一致 |

测试只采集 URL、产品标识、布尔结构信号、样式存在状态和选定 CSS 变量，不采集页面文字或输入内容。

## 恢复与故障处理

停用时，控制器先注销新文档脚本，再删除当前页面的固定 `<style>` 与根属性并验证不存在。彻底恢复会正常退出受控进程，重新验签客户端，然后以无调试参数启动官方 App。

正常退出超时会停止并报告，不使用 `kill -9`。若 Dashboard 不可用，可运行：

```bash
node src/cli.mjs restore-stock codex
node src/cli.mjs restore-stock workbuddy
```

随附 `.app` 只是本地便利包装器，不等同于 Developer ID 分发签名。正式商业发布仍需 Developer ID 签名、公证、更新签名和可验证的发行链。
