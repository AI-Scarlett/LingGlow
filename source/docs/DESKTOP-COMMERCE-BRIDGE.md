# macOS 桌面端可信购买与授权桥

实现位于 `src/desktop-commerce.mjs`、`src/release-commerce-trust.mjs`、`src/server.mjs` 以及原生菜单栏客户端。当前源码包**有意保持未配置**：没有账户门户 URL、授权服务 URL、发行配置根公钥或租约公钥，四个现有 Dodo Product ID 也只存在于 test mode。它不能显示成正式可购买状态。

## 信任链

```text
已签名/公证的 灵妆.app
  -> 内置发行配置验签公钥（源码默认 null）
  -> 验证 release/commerce-public.json 的 Ed25519 签名与有效期
  -> 只开放同源账户门户中的四个签名购买 URL
  -> HTTPS POST 到签名配置中的可信 entitlement service
  -> 收到 signedLease
  -> 用签名配置中的 Ed25519 租约公钥在本机验签
  -> 验签成功后才以 0600 + fsync + rename 原子保存短期租约
```

任何一层缺失、过期或不匹配都会关闭购买、兑换、刷新和设备停用。Product ID、授权服务返回的普通 JSON、`redemption` 元数据、结账回跳参数和 Dodo `valid=true` 都不能直接授予权益。

发行配置固定包含：

- `environment`：`live` 或 `test`；默认不允许 test 配置启用 C 端购买。
- `accountPortalUrl`：无凭据公网 HTTPS 账户门户。
- `productPortalUrls`：四个逻辑商品的签名 URL；必须与账户门户同源且位于其路径下。
- `entitlementServiceBaseUrl`：无凭据、无 query/hash、443 端口的 HTTPS 根 URL。
- `leaseSigningPublicKeySpki`：Base64URL DER/SPKI Ed25519 公钥。
- `issuedAt` / `expiresAt`：最长 370 天，便于轮换和撤销旧入口。
- `signature`：发行配置根私钥对固定字段 canonical JSON 的 Ed25519 签名。

模板在 `release/commerce-public.json.example`。运行时只读取精确文件名 `release/commerce-public.json`；示例文件不会启用任何功能。

## 兑换流程与首次皮肤选择

原生界面第一次提交授权码时不带 `skinId`，也不读取或猜测授权码类型：

1. 可信服务验证 Dodo 授权和自己的订单/订阅/数据库记录。
2. VIP 或自定义位授权码正常返回租约；自定义位的固定 `profileId` 由服务端创建或读取。
3. 单套皮肤码返回 `SELECTION_REQUIRED`。
4. 菜单栏才显示由本地正式 VIP 目录投影出的选择器。免费皮肤、自定义方案和豆包 blocked 预览不在其中。
5. 用户再次确认后才提交可选 `skinId`。服务端校验可售目录并将首次结果写入不可变 binding；以后不同选择返回 `BINDING_IMMUTABLE`。

`custom_slot_once` 不要求 VIP。租约可以同时包含多个独立的 `custom_slot_once` grant；原生编辑器从已验签的 `customProfileIds` 生成自定义位选择器，并且只允许保存或应用当前选中的 exact `profileId`。切换位不会改变服务端 binding，也不会让一个授权码生成第二个位。
6. 客户端最终仍只信任签名租约，不使用普通 `redemption` JSON 开权限。

请求使用 `POST /v1/redemptions`；刷新使用 `POST /v1/leases/refresh`；设备停用使用 `POST /v1/devices/deactivate`。请求只有 `licenseKey`、匿名稳定 `deviceId`、`clientVersion`、`platform=macos`，以及服务要求首次选择后才会出现的 `skinId`。

## macOS Keychain 与匿名设备 ID

- 原始授权码只存入 macOS Keychain。调用 `/usr/bin/security` 时密码通过 stdin 输入，绝不出现在 argv、shell 文本或日志中。
- 没有文件明文 fallback；Keychain 不可用时兑换、刷新和停用全部 fail closed。
- 可保存同一客户的多个商品授权码。租约仍按客户聚合 grant；设备停用逐个停用已保存授权码的 Dodo activation。
- Keychain 中另存 32 字节随机种子。发送给服务端的 `deviceId` 是种子与服务 origin 的 HMAC；同一可信服务配置轮换后仍稳定，不读取序列号、MAC 地址、用户名或其他硬件/账户标识，也不能跨服务关联。
- 短期 `signedLease` 不含原始授权码，保存在 Application Support 私有目录，要求当前用户拥有、普通文件、单硬链接、权限 0600。

## 网络边界

`SecureJsonTransport` 强制：

- 只请求签名配置中的 HTTPS endpoint；URL 不允许用户名、密码或 fragment。
- `credentials: omit`，不发送 Cookie、Authorization 或服务端 API Key。
- 8 秒默认超时（代码上限 20 秒）。
- 不跟随 3xx redirect。
- 只接受 `application/json`，响应默认最多 48 KiB。
- 远程错误只保留受限大写错误码并映射本地安全文案；远程 message 不进入 UI 或日志，避免服务回显授权码。

Dodo API Key、Webhook Secret、PostgreSQL URL、KMS/HSM 私钥及 customer session secret 只能存在于独立的 `commerce-service` 部署环境，桌面进程不读取这些环境变量。

## 发布前仍必须完成

以下项目没有合理默认值，当前仓库不会猜测：

1. 在 Dodo **live mode** 另建四个正式 Product ID、价格和 auto license-key entitlement。现有四个 ID 仅为 test mode；代码会因 `DODO_LIVE_PRODUCT_IDS_REQUIRED` 阻止 live 配置配合 test 目录启用。
2. 将 `src/products.mjs` 的完整目录切换为经过核对的 live 目录及 `live_mode` 标记，不能只切 API environment。
3. 部署可信账户门户与 `commerce-service`，配置数据库迁移、Dodo SDK adapter、Webhook、限流、客户认证和 KMS/HSM Ed25519 租约签名。
4. 生成独立的发行配置 Ed25519 根密钥。私钥放在 release KMS/HSM；把其 DER/SPKI 公钥写入 `src/release-commerce-trust.mjs`，然后重新构建。
5. 用发行配置私钥签名 canonical payload，生成 `release/commerce-public.json`；URL、环境、租约公钥或有效期任何变化都必须重新签名。
6. 当前构建脚本会在精确文件 `release/commerce-public.json` 存在且为非软链接、非空、最多 64 KiB 的普通文件时，将它复制到已签名的 `LingGlowBackend/release/`；`.example` 永不打包。生成配置后仍须做 Developer ID 签名、公证和 stapling。
7. 对 live 服务执行：购买四种商品、`SELECTION_REQUIRED`、不可换绑、多个授权码、订阅续期/过期、退款、拒付、刷新、设备停用、超时、重定向、超大响应和 Keychain 拒绝访问的端到端验收。

在以上步骤完成之前，`GET /api/products` 会返回明确的 `unconfigured` 或 `test` 状态，所有购买 URL 为 `null`，菜单栏按钮保持禁用。原生端还会独立检查 `environment=test` / `productDirectoryEnvironment=test_mode`，不会仅因宿主声称 `checkoutEnabled=true` 就开放当前四个测试 Product ID。
