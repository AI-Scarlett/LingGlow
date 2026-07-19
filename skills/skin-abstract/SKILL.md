---
name: skin-abstract
description: Create, adapt, package, and QA reusable light/dark skins for Codex/GPT, WorkBuddy, and Doubao. Use when making free or VIP theme packs, publishing LingGlow remote skin bundles, updating client layout compatibility, defining global and home artwork, replacing icons or mascots, fixing unreadable text and dialogs, or validating that visual overlays do not block native interaction.
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
7. Replace native mascot imagery in place. Do not add a second decorative frame. A custom avatar container must have transparent background, no border, no shadow, and no forced circular crop unless the skin explicitly requests it.
8. Accept an avatar as transparent only when the decoded image has a real Alpha channel. A checkerboard rendered into RGB pixels is not transparency.
9. Preserve native app appearance while a skin is active. Tell the user not to switch the Agent's own light/dark setting independently; reapply or warn when the states diverge.
10. Treat a successful build or injection probe as insufficient. Release only after screenshot-backed interaction QA in all three real clients.
11. Give every distributable WorkBuddy theme its own style-matched composer mascot. Sports themes should use a related object or symbol; never reuse one generic robot across unrelated themes.
12. Give every Codex theme a dedicated 3:1 home artwork that is visually related to, but not the same file as, the global background.
13. Record asset provenance and redistribution terms. Exclude any third-party person, character, logo, or artwork whose rights are unclear, even when it appears in an upstream preset repository.
14. Publish one declarative `.lingglow-skin.json` per skin. Never place JavaScript, CSS, executable files, arbitrary URLs, or source archives in a remote skin bundle.

## Inputs

Collect:

- `skinId`, version, free/VIP tier, display name, and source/license.
- `appearanceMode`: `light` or `dark`.
- Semantic colors: `canvas`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `border`, `selection`, `accent`, `danger`.
- Global background plus optional client-specific home artwork.
- Optional app icon, WorkBuddy composer mascot, and home title/subtitle per client.
- Target client versions and screenshots of every required page before adaptation.

Use the templates in `inputs/`. Read `references/asset-specs.md` before accepting images.

## Workflow

1. Record the exact Agent version and its native light/dark state.
2. Capture the live layout and identify stable semantic anchors such as roles, test IDs, native state attributes, and client-owned regions. Avoid hashed class names as the only selector.
3. Fill one client input template. Separate global background, home artwork, content surfaces, overlay surfaces, text tokens, selection states, and optional branding.
4. Apply the adapter contract in `patches/`. Start with narrow selectors and native state attributes. Do not use blanket rules such as `* { color: ... }`, `div { background: transparent }`, or global z-index promotion.
5. Apply the selected appearance to the Agent's native appearance selector when safely possible. Otherwise apply the complete matching semantic token set and show a warning not to change native appearance while the skin is active.
6. Keep the default background on one fixed visual layer. Make only approved content surfaces reveal it. Keep popovers and cards opaque enough to meet contrast.
7. Validate assets before injection. Reject oversize images, non-image payloads, and mascot files that claim transparency but have no Alpha channel.
8. Verify that the Codex home artwork and global background have different content hashes, and that every WorkBuddy pack resolves a theme-specific mascot asset.
9. Apply the skin, restart only the target Agent when required, then run the real-client matrix in `checks/layout-smoke-checklist.md`.
10. Capture screenshots for light and dark skins and exercise clicks, typing, scrolling, menus, hover cards, and embedded browser panels.
11. Package only after all required rows pass. Record Agent versions, skin version, appearance mode, screenshots, failures, and rollback result.

## Remote catalog packaging

Read `references/remote-distribution.md` when the user asks to share, publish, download, or install a skin through LingGlow. Build the project distribution with `node scripts/build_skin_distribution.mjs`; do not hand-edit generated bundle hashes or the public catalog index.

Publish in this order: skin bundle, gallery preview, catalog index. The index is always last so a visible catalog card never points to a missing package. Treat uploading to the public repository as an external release action and require explicit user authorization.

## Client rules

### Codex/GPT

- Keep sidebar, top toolbar, task list, composer, suggestions, and right-side browser usable.
- Use the optional home artwork only in the native home hero region; use the global background everywhere else.
- Do not cover top controls or the embedded browser with a full-window overlay.
- Preserve selected task/project state and disabled-button opacity.

### WorkBuddy

- Test home, history, expert/skill/connector pages, model menus, hover cards, notices, and speaker popovers.
- Let chat history and composer reveal the single global background; do not insert another cropped image.
- Keep cards and popovers contrast-safe rather than recoloring every inner text node.
- Replace the native composer mascot in place and preserve its native click target.

### Doubao

- Test home, current/history conversations, left navigation states, message text, composer, dialogs, and suggestions.
- Remove opaque chat canvases only where safe; keep message and input text readable in both appearances.
- Preserve left-tab selected/hover/pressed states and avoid a black veil over the background.

## Release gate

Do not mark a skin complete unless:

- The exact target client versions are recorded.
- Both light and dark skins pass semantic contrast checks.
- One global background remains continuous across home and history pages.
- Every overlay/menu/hover card is readable.
- History rows, sidebar tabs, composer controls, menus, and browser panels remain clickable.
- Custom avatar Alpha is verified when transparency is requested.
- Real screenshots exist for all three clients and rollback restores native appearance.

See `references/client-qa.md` for evidence requirements.
