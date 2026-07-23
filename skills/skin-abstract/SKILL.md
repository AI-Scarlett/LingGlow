---
name: skin-abstract
description: Create, adapt, package, and QA reusable light/dark skins for Codex/GPT, WorkBuddy, and Doubao. Use when making free or VIP theme packs, publishing LingGlow remote skin bundles, updating client layout compatibility, defining global and home artwork, replacing icons or WorkBuddy composer mascots, validating transparent-subject Alpha and padding, fixing unreadable text and dialogs, or checking that visual overlays do not block native interaction.
---

# Skin Abstract

Build one reusable theme manifest and three client adapters. Preserve each Agent's native layout and interaction model; skin visual surfaces rather than rebuilding the product UI.

## Non-negotiable contracts

1. Require an explicit `appearanceMode` of `light` or `dark` for every skin. Persist it with the skin and apply the matching client palette. Never infer the whole UI mode only from the average color of an image.
2. Use one global background for all pages. Make page surfaces transparent or translucent so they reveal that same background; never paint a second copy of the background inside chat history or the composer.
3. Allow a separate home/hero image only for a client-owned artwork region. Preserve surrounding native geometry, navigation, cards, suggestions, and composer dimensions.
4. Resolve text from semantic tokens. Use dark ink for light surfaces and light ink for dark surfaces. Do not force text to use a sampled background/accent color.
5. Keep dialogs, popovers, hover cards, model menus, tooltips, and cards on an opaque contrast-safe surface. Do not make every descendant transparent.
6. Set decorative background layers to `pointer-events: none`. Never use a broad `z-index` or pseudo-element that can cover native buttons, history rows, browser panels, menus, or text inputs.
7. Create the WorkBuddy composer mascot as a separate isolated-subject asset, never as a crop of the global background, Hero, banner, poster, or app icon. Replace the native mascot in place without a second decorative frame. Keep the container transparent with no border, halo, shadow, ground plane, or forced circular crop.
8. Accept a WorkBuddy composer mascot only when it passes the same hard gate as LingGlow runtime validation: decoded Alpha exists; aspect ratio is 0.8-1.25; at least 15% of pixels are transparent; at least 3% are occupied by the subject; and the occupied bounds retain at least 3% transparent padding on every side. Require at most 2 MB, 2048 px per edge, and 4 MP. A baked checkerboard, background image, circular crop, or technically transparent full-canvas poster fails. Run `node scripts/validate-composer-mascot.mjs <asset...>` before binding the asset.
9. Preserve native app appearance while a skin is active. Tell the user not to switch the Agent's own light/dark setting independently; reapply or warn when the states diverge.
10. Treat a successful build or injection probe as insufficient. Release only after screenshot-backed interaction QA in all three real clients.
11. Give every distributable WorkBuddy theme its own style-matched composer mascot and verify it in both the new-task and historical-task composer. Sports themes should use a related object or symbol; never reuse one generic robot across unrelated themes. If the custom or generated asset fails validation, reject it, show the user the required transparent-subject standard, leave `workbuddy.composerAvatar.image` null, and retain WorkBuddy's default robot; never substitute a background crop just to fill the slot.
12. Give every Codex theme a dedicated 3:1 home artwork that is visually related to, but not the same file as, the global background.
13. Record asset provenance and redistribution terms. Exclude any third-party person, character, logo, or artwork whose rights are unclear, even when it appears in an upstream preset repository.
14. Publish one declarative `.lingglow-skin.json` per skin. Never place JavaScript, CSS, executable files, arbitrary URLs, or source archives in a remote skin bundle.
15. Never add a background, border, or shadow to text merely because an element contains glyphs. Headings, paragraphs, labels, spans, placeholders, inputs, textareas, and content-editable text stay visually plain; paint one structural parent surface when readability needs a backdrop. For a composer, paint its outer shell and keep the nested editor/input layer transparent. Buttons, chips, selected rows, badges, code blocks, and standalone input controls remain explicit exceptions.
16. Resolve ink against the surface that is actually painted behind the text. A host dark-mode class is not evidence of a dark surface after a light skin replaces it; inspect the computed background or the closest effective semantic surface and choose contrast-safe ink from that result.
17. Runtime compatibility repair must stay narrow and reversible. If a client paints backgrounds directly on short text-only wrappers, clear only those wrappers and exclude controls, selected states, cards, dialogs, popovers, menus, code, and editable containers.
18. Never solve readability by placing one opaque surface over most of a page. Keep the page transparent, correct semantic ink first, and add translucent surfaces only to true local structures such as a user bubble, composer, table, code block, card, or popup. A large decorative region must use an edge-faded treatment with no visible rectangular boundary.
19. Treat send and stop as different semantic actions, not one button with two arbitrary colors. Derive send from `accent` plus a contrast-safe on-accent ink; derive stop from `danger` with a restrained running indicator. Preserve native geometry and hit targets. Give hover, focus, pressed, running, disabled, and reduced-motion states explicit treatments without turning either control into a solid black patch.
20. Lock the complete client semantic palette to `appearanceMode`, including host variables and any audited semantic utility classes that directly paint text or structural backgrounds. A native `dark` class may remain in the DOM after a light skin is applied; it must not be allowed to turn conversation copy, file cards, sidebars, output panels, or menus back to dark-mode colors.
21. Treat a model picker as one multi-level control. Theme the closed trigger, category menu, nested model list, reasoning and speed submenus, selected/checked rows, separators, icons, prices/badges, hover/focus states, and disabled rows together. Test every open level in both appearances.
22. Start every premium character, brand, Agent, or game skin from one intentional 16:10 key-art master, not from a generic gradient or abstract shape exercise. Prefer believable places, equipment, materials, and practical light when the requested subject is real or cinematic. A person is optional and is never the default for an Agent, CLI, or logo-led skin.
23. Reserve roughly the left 38-42 percent of the master as a low-detail UI-safe field and place the principal device, person, or scenic focal point on the right. Do this in the artwork itself; never recover a busy image later with a page-sized white or black veil.
24. For an Agent, CLI, or logo-led skin, make the mark the active functional hero: a compute core, photonic engine, compiler lattice, robotics controller, or data-routing system visibly connected to terminals, buses, telemetry, and infrastructure. Do not add people unless the user explicitly requests them, and do not settle for a logo pasted on a wall or floating over a generic room. Realism means plausible materials, lighting, scale, and function—not the presence of a human. When a named brand, person, character, or game is requested, record its unofficial fan-made status and verify the requested visual association rather than silently replacing it with a vague abstract substitute.
25. Derive the global background, 16:9 home Hero, 3:1 Codex banner, and transparent avatar from the approved master with separate crops. Review all four results; a technically valid crop that removes the face, emblem, or scene identity fails visual QA.

## Inputs

Collect:

- `skinId`, version, free/VIP tier, display name, and source/license.
- Catalog classification: one stable `category`, one `series`, and concise search `tags`.
- `appearanceMode`: `light` or `dark`.
- Semantic colors: `canvas`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `border`, `selection`, `accent`, `danger`.
- Global background plus optional client-specific home artwork.
- Approved 16:10 master key art, its UI-safe zone, focal-subject coordinates, avatar crop, and the intended real/cinematic rendering style.
- Optional app icon and home title/subtitle per client. A WorkBuddy composer mascot is required whenever `clientIds` includes `workbuddy`; it remains optional only for skins that do not target WorkBuddy.
- Target client versions and screenshots of every required page before adaptation.

Use the templates in `inputs/`. Read `references/asset-specs.md` before accepting images.

## Workflow

1. Record the exact Agent version and its native light/dark state.
2. Capture the live layout and identify stable semantic anchors such as roles, test IDs, native state attributes, and client-owned regions. Avoid hashed class names as the only selector.
3. Fill one client input template. Separate global background, home artwork, content surfaces, overlay surfaces, text tokens, selection states, semantic action controls, and optional branding.
4. Approve the full-resolution master before deriving client assets. Reject generic abstraction, weak brand recognition, pasted floating logos, an Agent mark with no visible computational function, unrequested people in logo-led skins, visibly synthetic anatomy, or a focal subject that collides with the left UI-safe region.
5. Apply the adapter contract in `patches/`. Start with narrow selectors and native state attributes. Do not use blanket rules such as `* { color: ... }`, `div { background: transparent }`, or global z-index promotion.
6. Audit text wrappers before styling. Remove accidental per-label paint, then put any required readability surface on the nearest structural container. Do not turn every text node or text input into a separate tile.
7. Apply the selected appearance to the Agent's native appearance selector when safely possible. Otherwise apply the complete matching semantic token set and show a warning not to change native appearance while the skin is active.
8. Resolve text tokens against the effective painted surface after all host and skin rules apply. Verify the result with computed styles or screenshots instead of trusting the host appearance class.
9. Keep the default background on one fixed visual layer. Make only approved content surfaces reveal it. Keep popovers and cards opaque enough to meet contrast.
10. Validate assets before injection. Run `node scripts/validate-composer-mascot.mjs <asset...>` for every WorkBuddy mascot. Reject oversize images, non-image payloads, missing Alpha, insufficient transparent area/padding, full-canvas posters, background crops, circular crops, and subjects clipped by the canvas.
11. Verify that the Codex home artwork and global background have different content hashes, and that every WorkBuddy pack resolves exactly one theme-specific `workbuddy.composer-avatar` asset with `fit: contain` and `shape: square`. Materialize the final profile or bundle and run the check again; validating only the source PNG is insufficient.
12. Apply the skin, restart only the target Agent when required, then run the real-client matrix in `checks/layout-smoke-checklist.md`.
13. Capture screenshots for light and dark skins and exercise clicks, typing, scrolling, menus, hover cards, and embedded browser panels.
14. Package only after all required rows pass. Record Agent versions, skin version, appearance mode, screenshots, failures, and rollback result.

## Remote catalog packaging

Read `references/remote-distribution.md` when the user asks to share, publish, download, or install a skin through LingGlow. LingGlow Remote Distribution v2 requires `category`, `series`, and `tags` so clients can search and filter without downloading the full pack. Build the project distribution with `node scripts/build_skin_distribution.mjs`; do not hand-edit generated bundle hashes or the public catalog index.

Publish in this order: skin bundle, gallery preview, catalog index. The index is always last so a visible catalog card never points to a missing package. Treat uploading to the public repository as an external release action and require explicit user authorization.

## Client rules

### Codex/GPT

- Keep sidebar, top toolbar, task list, composer, suggestions, and right-side browser usable.
- Use the optional home artwork only in the native home hero region; use the global background everywhere else.
- Do not cover top controls or the embedded browser with a full-window overlay.
- Preserve selected task/project state and disabled-button opacity.
- Verify permission, model, microphone, send, and stop controls independently from their adjacent text; do not create a background tile around each label or placeholder.
- Verify the complete nested model picker: closed trigger, model/reasoning/speed rows, child model list, selected check mark, separators, hover/focus, and disabled entries. Use semantic roles and state attributes where available, and force audited direct `text-token-*` / `bg-token-*` utility classes to the skin palette when variables alone do not win.
- Theme send with the skin accent gradient and contrast-safe icon ink. Theme stop with the semantic danger token, a non-black local surface, and a restrained running ring; keep native size, icon, event handling, disabled semantics, and reduced-motion behavior.
- Keep `main.main-surface` and `[data-app-shell-main-content-layout]` transparent. The fixed `body::before` layer is the sole global background owner; never repeat the same artwork on `body` or `main`.
- Replace Codex's solid thread-footer wash with a restrained edge fade that reaches full transparency before the reading area. The composer and right-side output panel remain independent, rounded, contrast-safe local surfaces.

### WorkBuddy

- Test home, history, expert/skill/connector pages, model menus, hover cards, notices, and speaker popovers.
- Let chat history and composer reveal the single global background; do not insert another cropped image.
- Keep cards and popovers contrast-safe rather than recoloring every inner text node.
- Replace the native composer mascot in place and preserve its native click target.
- Use the same validated custom mascot in the new-task composer and every historical-task composer surface that exposes the native mascot slot. Check both routes after navigation; a new-task-only replacement is incomplete.
- On custom upload, explain the standard before selection and reject invalid files with: “请上传透明画布上的完整独立主体，四周保留透明留白；不接受背景图、主视觉、圆形裁图或带底色图片。当前将使用默认机器人。”
- When validation or runtime replacement fails, remove the custom marker and retain the native default robot. Do not leave a broken image, blank slot, video remnant, duplicate overlay, or circular fallback.
- Check profile/account menus, history rows, automation templates, and table cells for accidental per-text backgrounds. Rounded structural panels are allowed; label-sized rectangles are not.
- Follow the Doubao conversation-detail pattern for chat: assistant prose stays directly on the shared background with contrast-safe ink; only user bubbles, composer, tables, code, cards, and overlays receive restrained translucent surfaces. Never turn the whole chat or automation page into one opaque panel.
- Treat automation empty-state, hero, and template-list wrappers as structural roots, not cards: keep those wrappers transparent and paint only the individual template cards.
- Normalize host dark-mode residue on structural controls instead of accepting black patches: remove any full-width team-member top fade entirely, and let only narrow lateral scroll affordances dissolve into the effective painted surface. Closed, hovered, focused, and expanded model/permission triggers must use the same local translucent control treatment; opened model and permission menus stay on an opaque contrast-safe surface with explicit semantic ink.

### Doubao

- Test home, current/history conversations, left navigation states, message text, composer, dialogs, and suggestions.
- Remove opaque chat canvases only where safe; keep message and input text readable in both appearances.
- Preserve left-tab selected/hover/pressed states and avoid a black veil over the background.
- Test AI Creation and conversation pages under a light background while the host reports dark mode. Titles, prompts, messages, and placeholders must switch to dark ink without receiving individual background strips.

## Release gate

Do not mark a skin complete unless:

- The exact target client versions are recorded.
- Both light and dark skins pass semantic contrast checks.
- Text remains plain unless it belongs to a real control or structural surface; no generated label-sized background boxes remain.
- One global background remains continuous across home and history pages.
- On Codex, verify a conversation with the right output panel open: the artwork focal subject remains visible, the main content root is transparent, and the composer footer does not form a large opaque rectangle.
- Every overlay/menu/hover card is readable.
- Codex model, reasoning, and speed menus pass with every submenu open; no row, icon, badge, check mark, or model trigger inherits stale host-mode ink.
- History rows, sidebar tabs, composer controls, menus, and browser panels remain clickable.
- Every WorkBuddy-targeting skin passes `scripts/validate-composer-mascot.mjs`, resolves exactly one final mascot asset, and displays the complete subject with `contain` and a transparent square container.
- The mascot is screenshot-verified in both a new task and an existing historical task. Invalid custom/generated assets show the upload guidance and fall back to the native default robot.
- Real screenshots exist for all three clients and rollback restores native appearance.

See `references/client-qa.md` for evidence requirements.
