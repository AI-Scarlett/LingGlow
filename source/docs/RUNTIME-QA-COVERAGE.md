# Codex / 豆包隔离运行时 QA 覆盖清单

[`src/runtime-qa-matrix.mjs`](../src/runtime-qa-matrix.mjs) 是未来升级 Codex 或豆包 exact Adapter 时使用的**机器可读检查清单**。它把“要跑哪些页面与状态”从自由文本变成可保存、可审计的数据，但它本身不启动应用、不连接 CDP、不写入 Adapter，也绝不授予任何皮肤能力。

```js
import {
  runtimeQaCoverageChecklistFor,
  runtimeQaCoverageChecklistGaps,
} from './src/runtime-qa-matrix.mjs';

const checklist = runtimeQaCoverageChecklistFor('codex');
// 在独立 QA 环境逐项填写 observedTargets / verified / selectorProof / cleanup。
console.log(runtimeQaCoverageChecklistGaps(checklist));
```

清单开始时固定为 `status: "planning-only"` 和 `promotionAuthority: "none"`。即使全部字段填满、`runtimeQaCoverageChecklistGaps()` 返回空数组，也只是“QA 覆盖项齐全”；仍必须经过现有的摘要锁定 Adapter 加载与人工审批门禁，才能发布 exact Adapter。

## 共同填写规则

每次隔离 QA 都需要把下列五类证据填齐：

1. **完整 target inventory**：`pageTargetInventoryComplete=true`，并且实际 page target 与该客户端的固定白名单逐项一致；不能挑选其中一个看起来安全的页面。
2. **路由与状态**：`routes.verified`、`states.verified` 必须覆盖清单中的每一个 ID。少一个就仍是候选，不能作为 exact 证据。
3. **选择器证明**：每项 `selectorProof.verified` 只保留 `id` 和 `method: "count-only"` 的有界结构/计数证明。不得保存页面文字、输入值、Cookie、Storage、会话路径或任意脚本结果。
4. **清理与原版恢复**：复用现有证据字段名，例如 `cleanupVerified`、`stockRestoreVerified`、`testCssRemoved`。隔离子进程、临时 Profile 或临时根目录未清完时，不得把检查写成完成。
5. **版本绑定与人工审查**：这份清单不是 Adapter 证据替代品。最终记录仍须由现有的 SHA-256 静态基线、运行证据与人工 review record 相互绑定。

## Codex

Codex 清单的路由和状态直接复用 `CODEX_RUNTIME_EVIDENCE_REQUIREMENTS`；Adapter 的 `runtimeEvidenceMatchesAdapter()` 也使用同一份常量。因此首页、项目、local / remote thread、Diff、设置、插件，以及侧栏、Composer、颜色、窗口和 reduced-motion 的覆盖不会出现“文档写一套、门禁查另一套”的漂移。

`send-stop` 和 `plugins` 的选择器槽在当前静态审计中标记为 `pending-runtime-discovery`。这不是允许使用模糊选择器：未来隔离运行时必须先审计出稳定的原生结构，再写入 count-only 证明；找不到稳定槽就不能为该区域提升能力。

真正运行 Codex 隔离 QA 仍受现有边界限制：只能在**单独 macOS 用户或一次性 VM**中执行，绝不能附着当前 Codex 会话。见 [`CODEX-STATIC-AUDIT.md`](CODEX-STATIC-AUDIT.md)。

## 豆包

豆包清单复用现有 `doubao-qa-policy.mjs` 的 candidate evidence kind、schema version、隔离 Profile 范围和“只读固定 DOM 计数”边界；固定 target 白名单也直接来自 `transport-strategy.mjs`。它覆盖 Side Panel、聊天、历史/导航，以及输入 idle / send / stop。历史导航与 send / stop 仍是 `pending-runtime-discovery`，不能用埋点名、页面文字或截图替代稳定 DOM 证明。

豆包完整清单仍不能解除 blocked 状态。要进入 exact，必须保持三份摘要锁定记录：静态基线、用户授权的隔离 candidate 证据、人工 exact review；随后启动层还会要求不可序列化的 reviewed transport/session plan。详见 [`DOUBAO-PHASE-1.md`](DOUBAO-PHASE-1.md)。

## 当前刻意未完成的运行时工作

- 当前 Codex 只保有静态候选；本线程不能把正在使用的 Codex 当作 QA 目标。
- 当前豆包保持 `blocked`、零能力；未获得新的明确授权时不得启动、重启或注入。
- 清单不提供“自动补齐”或“跳过一个页面”的路径；一旦实际版本、签名、摘要、target、选择器或恢复结果漂移，应新建静态审计和候选 Adapter，而不是修改旧记录。
