# LingGlow Remote Distribution v1

Read this file when a completed skin must be packaged for the public LingGlow catalog.

## Output contract

Create one Theme Pack definition and its referenced WebP assets under the project `catalog/` tree. Do not create executable code or arbitrary CSS inside a skin.

Required authoring facts:

- Stable lowercase `skinId`.
- Semantic version, free/VIP tier, and explicit `appearance.mode`.
- Supported Agent IDs.
- Global background, separate Codex 3:1 hero, and WorkBuddy transparent mascot when those slots are enabled.
- Source, license, and redistribution evidence.
- Real-client screenshots and rollback evidence before public release.

## Asset limits

- Global background: recommend 16:10, 2560 x 1600, WebP, at most 4 MB.
- Codex home artwork: recommend 3:1, 2400 x 800, WebP, at most 4 MB; hash must differ from the global background.
- WorkBuddy mascot: recommend 1:1, 1024 x 1024, transparent WebP, at most 2 MB; decoded Alpha is required.
- App/icon artwork: recommend 1:1, 1024 x 1024, PNG or WebP, at most 2 MB.
- Gallery preview: recommend 16:9, 1280 x 720 or larger, WebP/PNG, at most 2 MB.

## Packaging

After adding the definition to `catalog/theme-packs/index.json`, run:

```bash
node scripts/build_skin_distribution.mjs
```

The project packager creates a single `<skinId>.lingglow-skin.json` with Base64 WebP assets and SHA-256 locks. Do not hand-edit the generated bundle or public `catalog/v1/index.json`.

The maintainer uploads the bundle to the `skin-catalog-v1` GitHub Release, uploads the preview to `catalog/v1/previews/`, then publishes the generated index last. A user-created skin remains local until the maintainer completes rights review and real-client QA.
