# GitHub 远程皮肤目录 v1

灵妆 2.2.0 起把皮肤发现、下载和运行时应用拆成三个独立阶段。App 包只保留运行时、Legacy 兼容小资源和一套离线兜底皮肤；其余皮肤由 GitHub 目录按需分发。

## 公开地址

- 目录：`https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/catalog/v1/index.json`
- 预览：`https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/catalog/v1/previews/<skinId>.<ext>`
- 皮肤包：`https://github.com/AI-Scarlett/LingGlow/releases/download/skin-catalog-v1/<skinId>.lingglow-skin.json`

## 下载流程

1. 客户端读取远程索引；失败时使用本地缓存，首次离线时只显示 App 内兜底目录。
2. 目录卡片只读取名称、说明、明暗模式、Agent、预览 URL、包大小和 SHA-256。
3. 用户点击“下载”后，后端从固定的官方 GitHub Release 地址读取单皮肤包。
4. 后端校验包大小和外层 SHA-256，再校验定义文件与每个 WebP 的独立 SHA-256。
5. Theme Pack 继续经过本地 Union Schema 校验；Legacy 皮肤继续经过 v1 Schema 校验。
6. 全部通过后原子写入 `~/Library/Application Support/Codex Skin Studio/remote-theme-packs/<skinId>/`。
7. “应用”仍经过授权、目标 App 指纹、适配级别与一次性重启确认；下载不等于应用。

## 安全边界

- 远程包不能携带 JavaScript、CSS、SVG、可执行文件、文件路径或任意网络 URL。
- 定义文件最大 128 KB；单图最大 4 MB；单套图片总量最大 24 MB；单包最大 32 MB。
- 只接受 `assets/<safe-id>.webp`，拒绝重复、缺失和额外资源。
- 预览只能来自官方仓库的 `catalog/v1/previews/`。
- 皮肤包只能来自官方仓库 `skin-catalog-v1` Release。
- 已安装目录为 `0700`，文件为 `0600`，更新使用同目录原子替换和回滚。

## 发布流程

运行：

```bash
node scripts/build_skin_distribution.mjs
```

生成内容：

```text
dist/skin-catalog-v1/
├── bundles/*.lingglow-skin.json
└── catalog/v1/
    ├── index.json
    ├── GALLERY.md
    └── previews/*
```

上传顺序必须是：先上传或覆盖 Release 中的单皮肤包，再上传预览，最后更新 `index.json`。这样客户端永远不会先看到一个尚未可下载的目录项。
