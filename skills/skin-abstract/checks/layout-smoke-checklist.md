# Three-client skin release checklist

Record Agent version, skin ID/version, appearance mode, timestamp, and screenshot path for every row.

## Shared gates

- [ ] The chosen `appearanceMode` matches the Agent's native light/dark setting.
- [ ] The global background is a single continuous layer on home and history pages.
- [ ] Decorative layers use `pointer-events: none`; native controls remain clickable.
- [ ] Primary text reaches 4.5:1 contrast and large text reaches 3:1.
- [ ] Dialogs, menus, tooltips, hover cards, and placeholders remain readable.
- [ ] Selected, hover, pressed, focused, disabled, warning, and error states are visible.
- [ ] A transparent mascot decodes with a real Alpha channel; no baked checkerboard remains.
- [ ] Rollback restores the native theme and interaction behavior.

## Codex/GPT

- [ ] New-task home: optional hero image uses its own region without changing native block geometry.
- [ ] Sidebar: task/project selection and hover states are visible and clickable.
- [ ] Composer: typing, model menu, permission menu, send, stop, and microphone work.
- [ ] History: messages, code blocks, artifacts, notices, and action buttons are readable.
- [ ] Top toolbar: back/forward, sidebar, layout, and window controls remain visible.
- [ ] Right browser/terminal/file panels are not covered and accept pointer/keyboard input.

## WorkBuddy

- [ ] New task: title/subtitle, scenario tabs, capability buttons, composer, and mascot are correct.
- [ ] Mascot is replaced in place without frame, halo, shadow, or duplicate overlay.
- [ ] History rows: open, more, archive, pin, folder expand/collapse, and scrolling work.
- [ ] Chat history and composer reveal the global background without a second image.
- [ ] Expert/skill/connector pages use readable cards and tab/button states.
- [ ] Model menu, model hover card, speaker popover, notice popup, and tooltips are readable.

## Doubao

- [ ] Global background is visible without an opaque black veil.
- [ ] Left navigation selected/hover/pressed states are visible and clickable.
- [ ] Current and historical messages use the correct semantic text color.
- [ ] Composer typing, placeholder, attachments, tools, send, and microphone work.
- [ ] Suggestions, dialogs, popovers, and history list remain readable and interactive.

## Evidence

- [ ] Capture at least one full-window screenshot per page and appearance.
- [ ] Capture focused screenshots for any previously failing popup or interaction.
- [ ] Record click/type/scroll results; an injection log alone is not a pass.
