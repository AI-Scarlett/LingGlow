# Third-Party Notices

## Node.js runtime — official macOS release only

The notarized LingGlow distribution bundles the official Node.js runtime solely
to run LingGlow's local, signed backend. It does not use a target Agent's
runtime or install Node system-wide. The exact release version and upstream
archive SHA-256 values are pinned in
`native/Resources/NodeRuntime/manifest.json`; the release build verifies them
before packaging and includes the upstream `LICENSE` next to the binaries.

Node.js is distributed under the MIT License. The complete applicable license
text ships in `LingGlow.app/Contents/Resources/LingGlowNodeRuntime/LICENSE` in
each notarized release.

## Codex Dream Skin Studio — 注入引擎与 Dream Portal 演示美术

LingGlow (灵妆) includes a WebP conversion of `macos/assets/portal-hero.png` from:

- Project: [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)
- Source revision: `170b84439e021d3adc10c2459a45606f899f299d`
- Upstream file: `macos/assets/portal-hero.png`
- Original PNG SHA-256: `31bde93bb02d6723e0b6aa0ead675577604120acb0a6799163dd37f5cdd0a08e`
- Bundled WebP SHA-256: `2154717eedf080ea6ab608638022ecef67116c445e076a55bb02377d1cb415ba`

The upstream `macos/NOTICE.md` describes `portal-hero.png` as original abstract geometric artwork generated for that open-source repository, without characters. It also states that the MIT License applies to the software source code and this abstract demo asset. This notice does not grant rights to OpenAI or Codex trademarks, official application binaries, user-supplied images, or unrelated third-party artwork.

Codex Dream Skin Studio is an unofficial customization project and is not affiliated with, endorsed by, or sponsored by OpenAI. Its demo artwork is used here only as the clearly attributed visual asset for the free `Dream Portal 测试` skin.

### MIT License

Copyright (c) 2026 Codex Dream Skin Studio contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Codex Themes（freestylefly/codex-themes）— Codex 注入层局部移植

灵妆 LingGlow 的 Codex 注入层包含移植、改写自以下项目的少量代码与方法论：

- 项目：freestylefly/codex-themes（https://github.com/freestylefly/codex-themes）
- 许可：MIT License，Copyright (c) 2026 canghe
- 参考修订：`45dbc555242b2d792b2afbf9d3b6f364d0d479ff`（2026-07-27，作者 苍何 <2689458656@qq.com>）

移植涉及的上游文件与具体范围（灵妆采用的是逐条摘取，不是整文件引入）：

- `electron/engine/home-detection.ts`（sha256 `0f0dc05c1239003b87348593c0649cbc210203fd1e97d7202e4edec1ee43ae89`）——首页判定纯函数 `isActiveHomeSurface` 的判定式与「负向信号优先」设计。灵妆据此重写为 `src/codex-home-detection.mjs`，并沿用其「主进程纯函数经 `toString()` 注入渲染进程、从而使同一份逻辑可被主进程单测覆盖」的手法。
- `assets/inject/renderer-inject.js`（sha256 `05df1f1fc4b90b246405c26b41e4ac1256bdfe398f690c75147adc93871c75b3`）——用于比对渲染端注入生命周期和清理边界。灵妆没有复制其宿主产品判别、`localStorage` 写入或常驻 `setInterval` 轮询；现有运行时仍由灵妆自己的 MutationObserver、安装令牌和显式清理清单管理。
- `assets/inject/dream-skin.css`（sha256 `3670aa3c38594cd2c6a3197968d17e28fd4dedfe0ff6c072ed5a91cf81c4e91d`）——会话文本与浮层的若干语义选择器锚点（`.group/activity-header`、`.loading-shimmer-pure-text`、`[class*="_cadencedShimmer"]`、`[class*="_homeUtilityBar_"]`，以及 `[role="dialog"]` / `[role="tooltip"]` / `[data-sonner-toaster"]` / `[data-testid*="toast"]` 的浮层清单）。灵妆剥离了其绑定的主题 id 前缀并接入自有的 `--ds-*` 变量体系，未采用其全局 `z-index` 提升、装饰浮层、主题美术层与首页版式骨架。
- `assets/skills/generate-codex-theme/**`（`SKILL.md` sha256 `bbc1fef03bdd5ef30864a904f01d28448cd0f0502fbe13400221b1adcb0ab73b`；`references/image-composition.md` sha256 `a86dcff6704635996a1657b01e9d3d301227c8701e09f5cc080c99c59ad8a63d`；`references/layout-catalog.md` sha256 `f758c4acc2ac36f4d6950d0bf337e1b0bbdd4edaef4b4e3e56689a8ffe389020`）——主视觉构图方法论与「结构化配方 + 确定性校验脚本」的产出边界。灵妆在此基础上补充了第三方 IP 的生成期硬约束，并替换了其中引用的全部代表主题名。

上游 `NOTICE.md`（sha256 `f3da33e6dab25e82055bca701a8a0cb84cbd2e15a21d46e1bbae5a60f75a7999`）声明：codex-themes 的注入引擎本身移植自 MIT 许可的 Fei-Away/Codex-Dream-Skin（https://github.com/Fei-Away/Codex-Dream-Skin，Copyright (c) 2026 Codex Dream Skin Studio contributors）。因此来自该链条的代码同时受两份 MIT 许可约束，两份版权声明均予保留（Codex Dream Skin Studio 的 MIT 全文见上一节）。上游 `LICENSE` 的 sha256 为 `d038dcb411010601fe16605ff5a721dad1968900e178d6a729a74e71ea723e5a`，逐字副本存于 `src/vendor/codex-themes/LICENSE`。

本条目仅覆盖代码与文档方法论。灵妆**未收录** codex-themes 的任何预设美术、主题预览图、吉祥物、应用图标或营销素材。其中 `starcap-teemo` 与 `mirror-lake-ribbon` 经审计确认为第三方游戏角色与门派设定的同人衍生作品（上游 `theme.json` 的 `tags` 字段亦自标「同人」），`blue-window-messenger` 涉及既有即时通讯软件与桌面操作系统的商业外观模仿，`moonlit-immortal` 与 `paid-themes-src/` 为上游正在销售的付费商品母版——上述内容均按灵妆皮肤制作规范第 13 条排除，不在本条目授权范围内，也不随灵妆分发。

本条目不授予 OpenAI 或 Codex 商标、官方应用二进制、用户自备图片或任何无关第三方美术的权利。Codex Themes 与灵妆 LingGlow 均为独立的非官方项目，与 OpenAI 无隶属或背书关系。

### MIT License

Copyright (c) 2026 canghe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
