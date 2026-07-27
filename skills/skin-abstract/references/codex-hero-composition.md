# Codex hero composition

Composition methodology for the Codex 3:1 home artwork. This file governs *how* the
image is composed; `references/asset-specs.md` governs sizes and the hard decode/Alpha
gates. Do not restate the size table here.

Portions of this methodology are adapted from freestylefly/codex-themes
(`assets/skills/generate-codex-theme/references/image-composition.md` and
`layout-catalog.md`, MIT, Copyright (c) 2026 canghe). LingGlow strips the upstream
theme-id-bound layout skeletons and adds a third-party-IP generation gate that the
upstream skill lacks; see `THIRD_PARTY_NOTICES.md`.

## Generation modes

Decide the mode before composing, following the upstream three-mode split:

- `generate-image`: create a new master, then derive the 3:1 hero crop from it (default).
- `use-reference-image`: the user supplied an image; do not regenerate it. Choose the
  existing `advanced.banner.position` and `opacity` values that match its composition.
- `recipe-only`: adjust only those existing banner fields against an existing image and
  record the derived focus/safe-area values in the authoring worksheet for QA.

Generate one master at a time. Return file paths; never inline image bytes.

## Compose per taskMode

Codex exposes exactly three derived runtime task modes (contract 26); they are not new
union-profile fields. Compose for the mode selected by the existing assets and never
introduce a layout that reorders the native home DOM.

- `banner` — a wide 3:1 strip above the home content. Keep the text safe area on the left
  two-thirds; place the focal subject on the right or softly defocus it. Good for a single
  strong subject with calm negative space on the writing side. Example vibe: 落日工坊
  (warm, restrained light workbench).
- `ambient` — the artwork reads as a whole-window atmosphere behind translucent content.
  Reserve the left 38-42% as a low-detail UI-safe field (contract 23) and bias the subject
  right or bottom-right. Prefer layered, low-detail, atmospheric imagery. Example vibe:
  极光玻璃 (cool layered glass) or 紫雾星云 (deep violet nebula for a dark shell).
- `off` — no home artwork; the skin only re-tints the palette. Compose nothing; the color
  scheme carries the theme. Example vibe: 石墨专注 (low-distraction neutral dark).

## Focus and safe area

Focus and safe area are derived from the existing `advanced.banner.position`; do not add
`heroFocusX`, `heroFocusY`, or `heroSafeArea` to a union profile. The mapping is deliberately
deterministic because pixel saliency can mistake bright empty sky for a subject:

- `top-right` or `bottom-right` => `safeArea=left`, `focusX=.72`, `focusY=.5`.
- `top-center` => `safeArea=center`, `focusX=.5`, `focusY=.5`.

- Place the focal subject on the side **opposite** the declared safe area, so Codex welcome
  copy never fights the subject.
- Runtime image analysis still records aspect, palette, and saliency metadata for QA, but it
  does not override this author-declared side.

## Directional scrim, not a veil

Readability comes from a directional edge-gradient scrim keyed to the safe area
(`--ds-hero-scrim`), which already ships per-safe-area (left/right/center/none) and per-shell
(distinct light and dark ramps).

- The runtime derives a bounded scrim strength from existing `advanced.banner.opacity`; it
  only scales the directional gradient and is never a flat scalar over the whole image.
- Verify the scrim in **both** shells. A ramp tuned for the dark shell often crushes the
  light shell, and the reverse washes it out (contracts 12, 18).
- Never darken the entire frame or drop a page-sized veil to rescue a busy image. Fix the
  composition instead: give the writing side calm, low-detail negative space to begin with.

## Do not include

- Text, titles, slogans, watermarks, logos, or signatures baked into the art.
- Fabricated UI chrome — buttons, toolbars, window frames, title bars, scrollbars, tabs, or
  a fake cursor. Codex renders its own real chrome; painted chrome stacks a second frame
  (contract 27).
- A focal subject that touches any canvas edge; leave roughly 5-8% breathing room.
- A focal subject that falls inside the declared safe area instead of opposite it.
- Any recognizable third-party game/anime/film character, faction or world proper noun,
  brand mark or mascot, or another product's software trade dress. This is a generation-time
  hard gate (contract 28), not just an intake filter, and it applies even to an AI-regenerated
  likeness. Tags such as `同人`, `游戏`, `角色`, or `fan` are risk self-evidence requiring
  human review.

## Color and palette guidance

- Use layered color, not flat single-color fills. Keep saturation moderate-to-high without
  neon clipping, and keep enough tonal range that both a light and a dark palette are
  derivable from the master.
- `paletteGuidance.contrast` (`soft|normal|high`) and `paletteGuidance.temperature`
  (`cool|neutral|warm`) are derivation hints for choosing the nine semantic colors. They do
  **not** replace the explicit `appearanceMode` or the nine semantic colors, and the UI mode
  is never inferred from an image's average color (contract 1).

## Verify

Capture the home hero in both shells and with the right output panel open and closed. The
focal subject must remain in the visible conversation viewport in every state, the scrim must
read cleanly in light and dark, and no fabricated chrome may appear.
