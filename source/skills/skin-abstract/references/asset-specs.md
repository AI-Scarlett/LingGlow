# Asset specifications

| Asset | Recommended size | Ratio | Limit | Notes |
| --- | ---: | ---: | ---: | --- |
| Master key art | 2560x1600 or larger | 16:10 | 16 MP working file | Keep roughly 38-42% low-detail UI-safe area on the left and the focal subject on the right |
| Global background | 2560x1600 | 16:10 | 4 MB, max 4096 px edge, max 16 MP | JPG, PNG, or WebP; cover fit |
| Codex home artwork | 2400x800 | 3:1 | 4 MB | Used only in the native home hero region |
| WorkBuddy project/home artwork | 1920x1080 | 16:9 | 4 MB | Do not reuse as a second chat background |
| App icon | 1024x1024 | 1:1 | 2 MB, max 2048 px edge | PNG or WebP; transparent safe area preferred |
| Composer mascot/avatar | 1024x1024 | 1:1 recommended; 0.8-1.25 accepted | 2 MB, max 2048 px edge, max 4 MP | PNG or WebP with real Alpha; complete isolated subject only |

## Validation

1. Decode the file rather than trusting its extension or preview.
2. Confirm MIME type, dimensions, pixel count, and encoded size.
3. For transparent assets, confirm an Alpha channel exists and inspect corner pixels. Reject RGB images containing a baked checkerboard.
4. Preserve aspect ratio. Use `cover` for backgrounds and `contain` for icons/mascots unless explicitly overridden.
5. Show the recommended ratio, dimensions, and size limit beside every upload control.
6. Review the master and every derived crop visually. Identity, requested face when present, logo/device, and important environmental context must survive the 16:9 and 3:1 crops.
7. Prefer believable materials, lighting, anatomy when a person is requested, equipment, and locations for real/cinematic subjects. A generic abstract composition is not a substitute for a specifically requested brand, person, character, or game.
8. Agent/CLI/logo-led masters default to no people. Treat the logo or icon as an operating compute system with visible power, data, terminal, telemetry, or robotics connections; a logo merely pasted on a wall, monitor, or empty room does not satisfy the technology gate.

## WorkBuddy composer mascot gate

Run this before adding the asset to a skin and again against the final packaged asset:

```bash
node skills/skin-abstract/scripts/validate-composer-mascot.mjs path/to/mascot.png
```

The hard gate matches LingGlow runtime validation:

- Decode as PNG or WebP and contain a real Alpha channel.
- Keep file size at or below 2 MB, each edge at or below 2048 px, and total pixels at or below 4 MP.
- Keep width/height ratio between 0.8 and 1.25.
- Make at least 15% of pixels fully transparent and at least 3% occupied by the subject.
- Keep the occupied subject bounds at least 3% inside every canvas edge. Prefer 12-18% visual padding so the complete subject remains readable at approximately 96-140 px.
- Use one complete standalone subject. Reject background/hero/banner crops, circular portraits, full-canvas posters, ground planes, cast shadows, halos, frames, baked checkerboards, clipped limbs/details, or scenery that reaches the canvas edge.
- Bind the final asset to exactly one `workbuddy.composer-avatar` slot with `fit: contain` and `shape: square`.

If the asset fails, do not bind it. Tell the user what failed and retain WorkBuddy's default robot until a conforming replacement is supplied.

## Copy limits

- Home title: recommend 2-24 Chinese characters or 2-36 Latin characters.
- Home subtitle: recommend no more than 40 Chinese characters or 72 Latin characters.
- Preview truncation must not modify the saved value.
