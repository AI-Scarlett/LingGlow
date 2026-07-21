# Three-client skin release checklist

Record Agent version, skin ID/version, appearance mode, timestamp, and screenshot path for every row.

## Shared gates

- [ ] The chosen `appearanceMode` matches the Agent's native light/dark setting.
- [ ] The global background is a single continuous layer on home and history pages.
- [ ] Decorative layers use `pointer-events: none`; native controls remain clickable.
- [ ] Primary text reaches 4.5:1 contrast and large text reaches 3:1.
- [ ] Effective painted surfaces, not host light/dark classes alone, determine text ink.
- [ ] Headings, labels, paragraphs, placeholders, and editable text do not gain label-sized background, border, or shadow boxes.
- [ ] Composer/input-shell backgrounds belong to the structural shell; nested input, textarea, ProseMirror, and content-editable layers remain transparent without a second rectangular strip.
- [ ] Any readability backdrop belongs to one rounded or edge-faded structural container; buttons, chips, selected rows, badges, code, and true input containers are the only intentional text-sized exceptions.
- [ ] No non-modal readability surface covers most of the page; the global artwork remains visibly continuous behind primary content.
- [ ] Dialogs, menus, tooltips, hover cards, and placeholders remain readable.
- [ ] Selected, hover, pressed, focused, disabled, warning, and error states are visible.
- [ ] A transparent mascot decodes with a real Alpha channel; no baked checkerboard remains.
- [ ] Rollback restores the native theme and interaction behavior.

## Codex/GPT

- [ ] New-task home: optional hero image uses its own region without changing native block geometry.
- [ ] Sidebar: task/project selection and hover states are visible and clickable.
- [ ] Composer: typing, model menu, permission menu, send, stop, and microphone work.
- [ ] History: messages, code blocks, artifacts, notices, and action buttons are readable.
- [ ] New-task blocks and history text stay plain while permission/model/send controls keep their native control surfaces.
- [ ] Top toolbar: back/forward, sidebar, layout, and window controls remain visible.
- [ ] Right browser/terminal/file panels are not covered and accept pointer/keyboard input.

## WorkBuddy

- [ ] New task: title/subtitle, scenario tabs, capability buttons, composer, and mascot are correct.
- [ ] Mascot is replaced in place without frame, halo, shadow, or duplicate overlay.
- [ ] History rows: open, more, archive, pin, folder expand/collapse, and scrolling work.
- [ ] Chat history and composer reveal the global background without a second image.
- [ ] Assistant prose and automation-page copy sit directly on the global background; only bubbles, composer, cards, tables, code, and overlays use restrained translucent surfaces.
- [ ] Automation empty-state/hero/template-list wrappers stay transparent; only each template card receives a local rounded surface.
- [ ] Expert/skill/connector pages use readable cards and tab/button states.
- [ ] Model menu, model hover card, speaker popover, notice popup, and tooltips are readable.
- [ ] The full-width team-member top fade is absent and only narrow lateral scroll edges may dissolve into the painted surface; model and permission triggers stay locally translucent in closed, hover, focus, and expanded states while both menus remain opaque and readable.
- [ ] Profile menu, automation templates, history tables, and code content have no accidental per-label background tiles.

## Doubao

- [ ] Global background is visible without an opaque black veil.
- [ ] Left navigation selected/hover/pressed states are visible and clickable.
- [ ] Current and historical messages use the correct semantic text color.
- [ ] AI Creation titles/prompts and chat text follow a light painted background even when the host reports dark mode.
- [ ] Titles, prompts, messages, labels, and placeholders have no forced per-text background strips.
- [ ] Composer typing, placeholder, attachments, tools, send, and microphone work.
- [ ] Suggestions, dialogs, popovers, and history list remain readable and interactive.

## Evidence

- [ ] Capture at least one full-window screenshot per page and appearance.
- [ ] Capture focused screenshots for any previously failing popup or interaction.
- [ ] Record click/type/scroll results; an injection log alone is not a pass.
