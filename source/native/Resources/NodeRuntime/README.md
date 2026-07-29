# LingGlow bundled Node runtime

正式公证的 C 端发行包必须附带一套固定版本、来自 Node.js 官方的运行时，且同时包含 Apple Silicon 与 Intel 两个架构。源码只保留经过审查的下载清单；生成的二进制位于 `runtime/`、不进入源码控制。开发构建在该目录存在且校验通过时可以带上它，但只有正式发行脚本会把“必须内置运行时”作为硬性门槛。

安装或更新该运行时需要构建机已有 Node.js 22+ 来执行校验器：

```bash
node scripts/fetch_node_runtime.mjs --install
node scripts/fetch_node_runtime.mjs --verify
```

安装器只接受 `manifest.json` 中固定的两个 `nodejs.org` HTTPS archive 名称和 SHA-256 摘要。它只提取 `bin/node` 与 `LICENSE`，写入运行时完整性锁，并在替换旧目录前完成对临时树的架构、二进制哈希和版本验证；替换后验证失败会恢复先前可用版本。它绝不把 Homebrew、系统 Node 或目标 Agent 的内置 Node 当作正式发行运行时输入。

`scripts/package_macos_release.sh` 会设置 `REQUIRE_BUNDLED_NODE_RUNTIME=1`，并在缺少或校验失败时拒绝产生发行归档。成功后，`build_native.sh` 会把两个二进制、许可证和完整性锁复制到 `LingGlowNodeRuntime/`，随整个 `.app` 使用 Developer ID 签名；运行时优先启动与当前 Mac 架构匹配的那一个。正式发行还要求有效的 `LINGGLOW_DEVELOPER_TEAM_ID`、Developer ID Application 证书和 `NOTARYTOOL_PROFILE`，具体命令见 [项目发行说明](../../../README.md) 与 [原生菜单栏发行说明](../../README.md)。
