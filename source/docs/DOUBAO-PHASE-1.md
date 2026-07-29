# Doubao macOS 第一阶段 Adapter

豆包已进入 Provider、Doctor、Adapter schema、能力并集、Server 和 CLI，但当前状态严格为：

```text
level = blocked
transportVerified = false
capabilities = []
advancedAllowed = false
```

这不是“已支持换肤”。第一阶段只建立不会误认应用、资源或调试端口的信任基线，为后续经用户授权的隔离重启验证保留接口。

即使运行一次隔离验证，`--user-data-dir` 也只会新建临时 Chromium Profile，**不会**创建独立 macOS 用户或 VM；因此它不是账户级完全隔离。验证器不会注入皮肤，不读取页面文字、输入值、Cookie 或 Storage，只允许固定 DOM 节点计数，并且只有在临时进程清理和原版恢复都得到独立确认后才会输出候选证据。

## 应用身份

| 项目 | 固定值 |
|---|---|
| App | `/Applications/Doubao.app` |
| Bundle ID | `com.bot.pc.doubao` |
| Team ID | `96L78H6LMH` |
| 嵌套浏览器 | `Contents/Helpers/Doubao Browser.app` |
| 嵌套 Bundle ID | `com.bot.pc.doubao.browser` |
| Chromium Framework | `135.0.7049.72` |
| 本地 AI Extension ID | `obkcimipmjdkghadnfcjojepocldeggd` |

主 App 与嵌套浏览器都必须通过 `codesign --verify --deep --strict`，两者的 Team ID 必须一致。建立 `2.19.9` 固定快照时，Gatekeeper 结果为 `Notarized Developer ID`，发布者为 `Beijing Chuntian Zhiyun Technology Co., Ltd. (96L78H6LMH)`。

2026-07-17 的只读复核发生在锁屏会话中；该主机当时对多个独立已安装 App 都返回 `Authority=(unavailable)`、`codesign ... invalid signature` 和 `spctl ... internal error`。因此本次结果只能判定为 **Code Signing 子系统不可用于重新证明**，不能据此断言豆包被修改，也不能把旧快照当成本次已再次验签。Provider 的处理仍是正确的：只要 `codesign --verify` 不能成功，就保持 `signatureValid=false`、`safeToLaunch=false`、不解析前端资源且不允许启动或注入。重新登录并解锁后必须再次验签，只有成功结果才可继续运行时验证。

豆包不是 Electron App，也没有 `app.asar`。Provider 只读 Chromium Framework 下的本地 Extension 资源，不解包、不修改安装包。

## 已锁定的静态版本

### 2.12.7 审计快照

- Main CDHash: `03cb0115474cfda8c160194cadbcde2675deb986`
- Nested CDHash: `4e71a96af0503c4c55a8d00b38172a4b6f13e068`
- Manifest commit: `24612824c4abb2cfefa9ef6aaf8484b4fa69c3c7`
- Extension version: `1.0.0.4978`

### 2.19.9 当前磁盘版本

- Main CDHash: `d253e4d81b463aa3269156e32dbdbc161b99b01e`
- Nested CDHash: `853c671fc6413efe8ba5cece9ad87a305671f09e`
- Manifest commit: `3a04c286fa3f5511d21e6f8d228a88f80cda771c`
- Extension version: `1.0.0.6640`

`2.19.9` 完整 SHA-256 锁定如下：

| Artifact | SHA-256 |
|---|---|
| Main executable | `3f0c9e057bc0a65ae9a678fb3486e9cbbe24f8cd40d97c3865ae47b8e456ac00` |
| Main manifest | `d68b65ad7dd41dac882099751ace8b27a0577274034a8640b1c58adb9b567473` |
| Nested executable | `3ae362fc11fdd9775c683380a69e72f8a62455b4722c53427b44fa259d3a664e` |
| Chromium Framework | `ff7b32b6900e442f5dd4e84687ea54884c848ae7dbce3e543ba5b5aef0381e69` |
| Extension manifest | `bd638eb1fc2012b08765c7057a93810005f8452337f4efad91737f632a0fe130` |
| `side_panel.html` | `db02238f6156e22beb0f6c1aa8d2e59d94dea542f9b5e1513a5300eb58c9a4ea` |
| `side_panel.js` | `0d6c2c0be5eda7c31a6ac8e215c163fa92995ea2bf634684a1a87e6e79a74f16` |
| `side_panel.css` | `174fcf022b4bff7816724fc0b132115ae599b2e84c5bc8d8bc0fef10ccbd4552` |
| Linked design-token CSS | `b681c1669af8a9268e6da18e57dfb7499144a53fa01040ff3c564589195dadae` |

Provider 同时检查 `#root`、Side Panel 资源引用、豆包主页 content script、语义 `data-testid` 标记与 `--s-color-*` / `--dbx-*` / `--chat-*` 设计令牌。任何一个签名、版本、CDHash、commit、Extension ID/版本或资源哈希不匹配，都不会命中静态 Adapter。

### 2.19.9 静态运行时提示

2026-07-17 对固定哈希对应的文件做了有界字符串复核，得到：

| 文件 | `remote-debugging-pipe` | `remote-debugging-port` | `DevToolsActivePort` | `saman-from-chat` |
|---|---:|---:|---:|---:|
| 主包装器 `Contents/MacOS/Doubao` | 否 | 否 | 否 | 否 |
| 嵌套启动器 `Doubao Browser` | 否 | 否 | 否 | 否 |
| Chromium Framework | 是 | 是 | 是 | 是 |

这只证明嵌入的 Chromium 135 含有标准调试开关和豆包进程关联开关，**不证明**原生主包装器会转发 argv、隔离 `user-data-dir` 或 Pipe 的文件描述符。代码把这些结果放在 `staticRuntimeHints`，并固定标记：

```text
evidenceClass = static-only
runtimeDomVerified = false
wrapperArgumentForwardingVerified = false
```

本地 AI Extension 是 Manifest V3，`side_panel.default_path=side_panel.html`；主页桥接脚本在 `document_start` 加载。静态资源能确认 Side Panel 的 `#root`、骨架输入框/发送按钮，以及 `[data-testid=chat_input]`、`[data-testid=chat_input_input]`、`[data-testid=message_text_content]` 三个固定字符串。代码不再把 `send_message` 遥测名或 `message-list` 事件名误称为 DOM 选择器。以上仍不是实时 DOM 证据，因此没有新增任何 capability 或 CSS 规则。

## 目标白名单

只声明两类 page target：

```text
chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html
https://www.doubao.com/chat/*
```

子域仿冒、其他豆包路径、背景 Service Worker、登录页、任意第三方页面与其他 Extension 全部拒绝。

## 传输门禁

早期只读进程快照没有观察到 `--remote-debugging-pipe`、调试端口或 `DevToolsActivePort`。2026-07-17 复核时没有观察到正在运行的豆包主进程，因此本次不能重新证明其 argv。历史审计确认的 `127.0.0.1:49853` 是 `share_plugin` 内部服务，`/json/version` 返回 404；代码将该端口永久列为非 CDP，不允许它通过证据验证。

启动策略按下列顺序预留：

1. `wrapper-forwarded-pipe`：优先，但必须证明主包装器把 Pipe 参数和 FD 传到嵌套浏览器，同时保持 `--saman-from-chat=<mainPid>` 链路。
2. `isolated-loopback`：只是后备接口；必须使用 `127.0.0.1`、隔离 Profile、运行时临时端口、验证端口归属于嵌套浏览器，且 Browser 版本与固定 Chromium 一致。当前执行器未实现。

`verifyTransportEvidence()` 只验证有界的候选证据结构，自身不启动、不附加、不重启应用。候选证据必须有固定 `kind`、`schemaVersion=1`、`status=candidate-runtime-probe`、`cleanupVerified=true`、`stockRestoreVerified=true` 和 `noAutomaticPromotion=true`；它还必须绑定当前 App fingerprint、用户授权、临时 Profile 范围、隔离 `user-data-dir` 已转发、主/嵌套 PID 链、嵌套进程确实带 Pipe 参数、Chromium 版本与完整 page-target 白名单清单。Pipe 证据还必须明确证明 `DevToolsActivePort` 不存在；缺字段也按失败处理。

即使该结构通过，函数也只返回“候选证据有效”，`verified` 仍为 `false`，不会自动开启 transport、Adapter 或皮肤能力。后续必须人工审查、完成状态矩阵与恢复证据，并随新 `exact` Adapter 一起发布。逐项填写 target inventory、页面/状态、选择器 count-only 证明与 cleanup/stock restore 的共享机器可读清单见 [`RUNTIME-QA-COVERAGE.md`](RUNTIME-QA-COVERAGE.md)；该清单不是 transport 授权。

在完成这项真实隔离测试之前，Provider 不存在任何可将 `transportVerified` 设为 `true` 的自动探测路径。即使传输未来通过，当前 Adapter 仍因 `capabilities=[]` 保持 blocked，直到实时 DOM 和安全注入回归完成后发布新 Adapter。

### Exact Adapter 的三份摘要锁定证据

内置 `2.19.9` Adapter 仍是 `blocked`，不能因为静态文件匹配、某个 JSON 写入 `verified: true`，或复制一份已审核 JSON 就开启 Pipe。要发布新的 `exact` Adapter，加载器必须同时验证三份彼此绑定且 SHA-256 摘要锁定的证据：

1. 当前 App/Extension 的静态基线；
2. 经用户授权、完成清理和 stock 恢复的隔离候选运行时证据；
3. 人工审查记录，它必须绑定前两份摘要、同一 App fingerprint、目标白名单、`wrapper-forwarded-pipe` 和实际开放的能力集合。

三份都通过后，只有 Adapter 加载器会在内存中创建不可序列化的运行时信任令牌；启动层只接受该令牌，才允许 `wrapper-forwarded-pipe`。普通 JSON 的 `verified` 字段、手工构造对象、对象展开/克隆或单独替换其中一份证据都不会通过。这是未来升级的发布门禁，不表示本机已执行豆包隔离测试或已启用皮肤。

即使未来发布了已审核的 exact Adapter，生产启动层也不会把该令牌直接当作普通 argv。它会在内存中再铸造一个不可序列化的隔离会话计划：每一次 Pipe 启动（包括单实例正常退出后的有限重试）都必须新建一个当前用户拥有的 `0700` 临时 profile，并且 argv **只能**是 `--remote-debugging-pipe` 与该 profile 的 `--user-data-dir=...` 两项；环境变量只保留 locale、shell、PATH、HOME/TMPDIR 等白名单。计划、令牌或对象副本都不能物化 profile / argv / 环境。结束时先确认直接 ChildProcess 已退出、CDP Pipe 已关闭，并用 `lsof +D` 证明临时 profile 无任何打开句柄，才允许删除目录；任一证明失败就保留私有目录并使会话失败关闭。当前内置静态 Adapter 仍是 `blocked`、零能力，这条生产隔离路径尚不会启动豆包。

## 下一次单次重启的最小验证清单

必须先解锁并重新登录，让主 App 与嵌套 App 的 `codesign --verify --deep --strict` 都成功。随后获得用户对这一次豆包重启的明确授权，再由专用验证器完成；不能用 `open --args` 代替 Pipe harness：

1. 创建全新的 `0700` 临时 `user-data-dir`，记录其真实路径、所有者和测试前为空。该目录仅隔离 Chromium Profile，不等同于独立 macOS 用户或 VM。
2. 直接启动已验签的 `/Applications/Doubao.app/Contents/MacOS/Doubao`，仅传入：

   ```text
   --remote-debugging-pipe
   --user-data-dir=<全新临时目录>
   ```

   harness 必须为 CDP 提供继承的 FD 3/4，不开放 TCP 端口。
3. 只读记录主进程和嵌套 Browser 的 PID/PPID/完整调试参数分类；必须看到嵌套进程同时保留 `--remote-debugging-pipe`、隔离 `--user-data-dir` 和 `--saman-from-chat=<mainPid>`。任一缺失立即失败并恢复原版启动。
4. 通过 Pipe 调用 `Browser.getVersion`，必须精确返回 `Chrome/135.0.7049.72`；确认没有 `DevToolsActivePort`。
5. 获取一次完整 target inventory。所有 `type=page` 的 target 必须只属于固定 Extension 页面或 `https://www.doubao.com/chat/<非空路径>`；不能只挑选“看起来安全”的子集提交给验证器。
6. 只运行固定、无页面文本输出的 DOM 计数探针：`body`、`#root`、三个已知 `data-testid`，以及后续逐页审计确定的稳定节点。不得读取输入值、对话正文、Cookie、Storage 或任意脚本结果。
7. 先只证明传输和 DOM；不要注入皮肤。完成首页、会话、历史/导航、输入/发送/停止等状态矩阵后，另发一个仍可回滚的 exact runtime Adapter，才允许从 `capabilities=[]` 提升。
8. 关闭验证进程、删除临时 Profile、确认无残留调试进程和端口，再以无调试参数正常启动豆包。清理会同时核验 PID/PPID/启动时间账本、唯一临时 Profile 参数和该 Profile 的打开文件句柄；PID 生命周期异常、残留句柄或清理失败时，不删除目录也不恢复普通启动。

## 测试

```bash
npm test
node src/cli.mjs doctor
```

`npm test` 不启动或重启豆包。它覆盖静态 Adapter 匹配、零能力降级、target 白名单、证据指纹/PID/版本绑定、仿冒 URL、`49853` 拒绝、Pipe 优先顺序与未实现 Loopback 回退。

## 隔离 Pipe/DOM 验证器（尚未执行）

新增的 `tests/integration-doubao-isolated.mjs` 是一次性的、**显式 opt-in** 验证器；它不属于 `npm test`，也不会被菜单栏应用或普通 Doctor 调用。其实现位于 [src/doubao-isolated-qa.mjs](../src/doubao-isolated-qa.mjs)。在当前锁屏 / Code Signing 子系统不可用的状态下，绝不能运行它。

只有在用户重新登录、主 App 与嵌套 Browser 的签名重新验证成功，并且用户明确同意本次豆包退出和重启后，才可以在终端手工执行：

```bash
LINGGLOW_DOUBAO_QA_ACK=I_AUTHORIZE_ONE_ISOLATED_DOUBAO_RESTART \
LINGGLOW_DOUBAO_QA_BOUNDARY=I_ACCEPT_FIXED_DOM_COUNTS_NO_CONTENT_ACCESS \
npm run test:doubao:isolated
```

两个环境变量缺任意一个，验证器会在读取 App、退出 App 或创建目录之前失败。它随后依次执行以下受限流程：

1. 再次要求 `/Applications/Doubao.app` 主 App 和嵌套 Browser 均通过当前签名信任链，并精确匹配 `qa/doubao-static-2.19.9.json` 的版本、CDHash、Extension 与资源哈希；升级或漂移一律拒绝。
2. 仅在双重确认后正常退出已有豆包；残留任何主 / Browser 进程都停止，不会启动隔离实例。
3. 建立全新的、当前用户拥有且权限为 `0700` 的临时 `user-data-dir`，并直接启动已验证的主可执行文件。启动参数严格只有：

   ```text
   --remote-debugging-pipe
   --user-data-dir=<fresh-0700-temp-dir>
   ```

   标准输入输出错误全部忽略，继承的 FD 3/4 专用于 CDP Pipe；不开放 TCP 调试端口，也不使用 `open --args`。
   子进程环境是严格白名单，仅保留 `HOME`、`USER`、`LOGNAME`、`TMPDIR`、`PATH`、`SHELL` 和语言 / CoreFoundation locale 变量；不会传递 OpenAI/Dodo Key、HTTP 代理、SSH agent、Codex 配置或 Node 调试变量。
4. 仅收集有界的进程分类（PID、PPID、角色、Pipe / profile / `--saman-from-chat` 标记）、`Browser.getVersion`、一次完整 target 清单与固定 DOM 计数。清理期另用 PID/PPID/启动时间账本和临时 Profile 文件句柄核验后代进程；证据不会保存完整命令、页面标题、页面文本、输入值、Cookie、Storage、聊天路径或 query/hash。
5. 所有 `type=page` target 必须逐一匹配固定白名单。DOM 探针只统计 `body`、`#root`、`chat_input`、`chat_input_input`、`message_text_content` 的数量；它不会读文本、表单值、Cookie 或 Storage。
6. 无论成功还是失败，关闭 Pipe，终止这次临时 profile 对应的测试进程，确认没有残留调试进程或打开该目录的文件句柄，删除临时 profile；只有清理已确认成功时才以无调试参数正常启动已验证的豆包。PID 被复用、句柄无法枚举或目录仍被占用都会失败关闭并阻止恢复。

验证输出的 `exactAdapterEnabled`、`capabilitiesElevated` 和 `noAutomaticPromotion` 分别永远是 `false`、`false` 和 `true`，并且必须带有 `cleanupVerified=true`、`stockRestoreVerified=true`。它只是下一次人工审查的候选运行时证据，绝不会改变 Adapter、开放皮肤注入、读取用户内容或提升任何 capability。
