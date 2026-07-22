# Client QA evidence

Use real installed clients, not static HTML alone.

For every client and appearance:

1. Record client version and native appearance before applying the skin.
2. Apply the skin and capture the home page.
3. Open an existing conversation and capture the history page.
4. Exercise navigation, typing, scrolling, model selection, menus, popovers, and previously failing controls.
5. Inspect headings, body copy, labels, placeholders, inputs, and content-editable regions at screenshot scale. Fail the build if text-only descendants acquire their own background, border, or shadow instead of inheriting one structural surface.
6. Compare the host-reported appearance with the effective painted surface behind representative text. When they disagree, verify that ink follows the painted surface and still meets contrast.
7. Capture any client-specific page listed in the release checklist.
8. Roll back and confirm the native appearance returns.

Accept a result only when screenshots and interaction observations agree. A successful build, process launch, CSS presence check, or runtime probe is supporting evidence, not visual QA.

Focused regression pages:

- Codex: new-task blocks, conversation history, transparent main roots, edge-faded thread footer, open right output panel, permission menu, closed model trigger, first-level model/reasoning/speed menu, nested model list with a selected check mark, composer placeholder, and send/stop/microphone controls. Capture both appearance modes plus send idle/hover/focus/disabled and stop running/hover/focus states; verify semantic variables and audited direct `text-token-*` / `bg-token-*` utility classes, icon contrast, native click targets, and reduced-motion fallback.
- WorkBuddy: profile/account menu, project/history list, automation templates, chat history tables and code blocks, model/speaker/notice popovers.
- Doubao: AI Creation header and prompt, current/history conversations, left navigation, composer placeholder, suggestions and dialogs.
