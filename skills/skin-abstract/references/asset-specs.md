# Asset specifications

| Asset | Recommended size | Ratio | Limit | Notes |
| --- | ---: | ---: | ---: | --- |
| Master key art | 2560x1600 or larger | 16:10 | 16 MP working file | Keep roughly 38-42% low-detail UI-safe area on the left and the focal subject on the right |
| Global background | 2560x1600 | 16:10 | 4 MB, max 4096 px edge, max 16 MP | JPG, PNG, or WebP; cover fit |
| Codex home artwork | 2400x800 | 3:1 | 4 MB | Used only in the native home hero region |
| WorkBuddy project/home artwork | 1920x1080 | 16:9 | 4 MB | Do not reuse as a second chat background |
| App icon | 1024x1024 | 1:1 | 2 MB, max 2048 px edge | PNG or WebP; transparent safe area preferred |
| Composer mascot/avatar | 1024x1024 | 1:1 | 2 MB | PNG or WebP with real Alpha when transparency is required |

## Validation

1. Decode the file rather than trusting its extension or preview.
2. Confirm MIME type, dimensions, pixel count, and encoded size.
3. For transparent assets, confirm an Alpha channel exists and inspect corner pixels. Reject RGB images containing a baked checkerboard.
4. Preserve aspect ratio. Use `cover` for backgrounds and `contain` for icons/mascots unless explicitly overridden.
5. Show the recommended ratio, dimensions, and size limit beside every upload control.
6. Review the master and every derived crop visually. Identity, face, logo/device, and important environmental context must survive the 16:9 and 3:1 crops.
7. Prefer believable materials, lighting, anatomy, equipment, and locations for real/cinematic subjects. A generic abstract composition is not a substitute for a specifically requested brand, person, character, or game.

## Copy limits

- Home title: recommend 2-24 Chinese characters or 2-36 Latin characters.
- Home subtitle: recommend no more than 40 Chinese characters or 72 Latin characters.
- Preview truncation must not modify the saved value.
