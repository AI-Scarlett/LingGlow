# Dream Skin 对比与产品化决定

## 一句话结论

Codex Dream Skin 更像一套脚本化换肤包；灵妆（LingGlow）的目标是一个面向普通用户的本地产品。我们吸收它的选图、皮肤库、快速切换和热更新体验，但保留更严格的签名校验、声明式皮肤、CDP Pipe、版本降级、一次性重启确认和双应用适配。

## 对比

| 维度 | Codex Dream Skin | 灵妆 LingGlow |
|---|---|---|
| 产品形态 | Bash/PowerShell、菜单栏脚本、素材目录 | 本地可点击工作台 |
| 注入通道 | 本机 TCP 调试端口 | 仅匿名 CDP Pipe，不开放监听端口 |
| 皮肤内容 | 固定 CSS、JavaScript、图片 | 声明式字段，经程序编译为受控 CSS |
| 版本安全 | 依赖选择器继续可用 | 签名、发布者、ASAR 指纹、静态信号、运行时探针 |
| 更新处理 | 失效后手动适配 | exact / generic-safe / blocked 分级降级 |
| 消费者体验 | 选图、主题目录、菜单切换较直观 | 免费/VIP 皮肤库、自定义、七日排程、明确确认 |
| 应用范围 | Codex | Codex + WorkBuddy |
| 恢复方式 | 脚本恢复/重新启动 | 一次性恢复意图，重新核验后执行 |

## 已吸收的体验

- 内置皮肤库和明显的视觉预览。
- 免费、VIP、自定义三类皮肤来源。
- 目标应用切换。
- 皮肤保存、最近使用和恢复原版入口。
- 每周七天排程，以及“立即切换 / 稍后 / 今天跳过”的提醒模型。
- 快速切换时仍会重新执行安全检查。

## 明确不吸收的实现

- 不开放 `--remote-debugging-port`。
- 不接受主题包携带任意 CSS、JavaScript 或远程 URL。
- 不依赖 `nth-child`、动态类名等脆弱选择器作为基础能力。
- 不修改或覆盖目标应用的 `app.asar`。
- 不因打开工作台、浏览皮肤或预览皮肤而启动目标应用。
- 不在用户未确认时自动重启 Codex 或 WorkBuddy。

## 上游项目当前可见风险

- 当前 macOS 主题配置引用了仓库中缺失的背景图，相关修复见上游 [PR #9](https://github.com/Fei-Away/Codex-Dream-Skin/pull/9)。
- macOS 启动脚本先调用内部启动函数，随后又执行一次 `open -na`，存在重复创建应用实例的风险。参见 [启动调用处](https://github.com/Fei-Away/Codex-Dream-Skin/blob/d80a3bcd6750e7581e57b0460de050a8f6ad9a96/macos/scripts/start-dream-skin-macos.sh#L54-L60) 和 [内部启动函数](https://github.com/Fei-Away/Codex-Dream-Skin/blob/d80a3bcd6750e7581e57b0460de050a8f6ad9a96/macos/scripts/common-macos.sh#L508-L525)。
- 上游的自定义图片和菜单切换体验值得参考，分别见 [选图流程](https://github.com/Fei-Away/Codex-Dream-Skin/blob/d80a3bcd6750e7581e57b0460de050a8f6ad9a96/macos/scripts/customize-theme-macos.sh#L35-L77) 与 [菜单主题库](https://github.com/Fei-Away/Codex-Dream-Skin/blob/d80a3bcd6750e7581e57b0460de050a8f6ad9a96/macos/menubar/codex_dream_skin.10s.sh#L76-L123)。

## 商业边界

当前版本实现本地 Catalog、权益门禁和离线签名许可证接口，但不伪装成已经接入支付。正式销售 VIP 前仍需配置服务器私钥、激活/续期接口、支付回调、Developer ID 签名、公证和自动更新。安全更新、恢复原版和基础应用兼容不会成为付费功能。
