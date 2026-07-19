# Asset specifications

| Asset | Recommended size | Ratio | Limit | Notes |
| --- | ---: | ---: | ---: | --- |
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

## Copy limits

- Home title: recommend 2-24 Chinese characters or 2-36 Latin characters.
- Home subtitle: recommend no more than 40 Chinese characters or 72 Latin characters.
- Preview truncation must not modify the saved value.
