# Dodo Payments 授权与不可变绑定方案

本文定义灵妆（LingGlow）的商业授权边界、服务端数据约束，以及 macOS 客户端接收的签名权益租约。当前仓库已经接入四个 **Dodo test mode** Product ID 的只读目录，并实现可信 Checkout/Webhook/License/PostgreSQL 服务、桌面租约验签和三类权益门禁；服务仍须独立部署和配置。四个 ID 在 live mode 不存在，代码会主动拒绝把它们用于正式收费。

## 三种且仅三种商品权益

| offerType | Dodo 商品 | 有效期 | 解锁范围 | 绑定规则 |
|---|---|---|---|---|
| `vip_subscription` | 月付或年付订阅 | 订阅有效期内 | 全部内置 VIP 皮肤、自定义皮肤、七日排程、登录提醒及后续 VIP 功能 | 不绑定某一皮肤 |
| `skin_once` | 共用的单皮肤一次性商品 | 永久，退款或拒付时停用 | 首次兑换选择的一个 `skinId` | 首次兑换后永久保留该绑定，不能换成另一皮肤 |
| `custom_slot_once` | 一个自定义位的一次性商品 | 永久，退款或拒付时停用 | 仅一个固定 `profileId`；该皮肤内容可以反复编辑 | 首次兑换时服务端生成 `profileId`，以后不能换位或再创建一个位 |

“永久”指购买记录和资源绑定没有到期时间，并不表示客户端可以永远离线。客户端使用短期签名租约，以便退款、拒付和风控撤销能生效。

首用 7 天免费 VIP 试用不属于第四种 Dodo 商品，也不含 Dodo `license_key`、customer、grant 或签名租约。它仅在本机第一次解析权益时生成一次，并以当前用户私有、权限 `0600` 的原子记录保存开始/到期时间和最高已观察时间，防止把系统时间往回调来延长窗口。普通设备停用、移除本机授权缓存不会删除该记录。有效的付费 VIP 订阅优先；有效的单皮肤/自定义位租约会在试用期间保留真实绑定，试用到期后恢复其原有范围。

## 系统边界

```text
灵妆 macOS
  -> LingGlow Entitlement Service
       -> Dodo Payments Checkout / License API
       <- Dodo Payments Webhooks
       -> PostgreSQL immutable bindings
       -> KMS/HSM Ed25519 lease signer
  <- signed schemaVersion 2 lease
```

- Dodo API Key、Webhook Secret 和 Ed25519 私钥绝不进入桌面安装包。
- 客户端只把用户输入的授权码保存到 macOS Keychain，并把服务端返回的短期签名租约以当前用户所有、权限 `0600` 的原子文件保存；没有明文授权码文件 fallback。
- 客户端只信任内置的 Ed25519 公钥。签名失败、租约过期、受众不符或客户端不符时立即回退到免费版。
- Dodo 的设备 activation/deactivation 只管理设备数量。它不能删除或改变皮肤/自定义位绑定。

Dodo 官方能力参考：[License Keys](https://docs.dodopayments.com/features/license-keys)、[Activate License](https://docs.dodopayments.com/api-reference/licenses/activate-license)、[Validate License](https://docs.dodopayments.com/api-reference/licenses/validate-license)、[Deactivate License](https://docs.dodopayments.com/api-reference/licenses/deactivate-license)、[Subscriptions](https://docs.dodopayments.com/features/subscription)、[Entitlements](https://docs.dodopayments.com/api-reference/entitlements/create-entitlement)。Dodo 不负责“第一次兑换后绑定到哪个灵妆资源”，这部分必须由我们的服务端和数据库约束完成。

## 单一产品目录与公开接口

四个 Product ID 只在 `src/products.mjs` 定义一次，不能在 Swift、Web UI、Webhook handler 或数据库迁移中再硬编码一份。目录映射为：

| catalog id | Dodo Product ID | billing | offerType |
|---|---|---|---|
| `vip-monthly` | `pdt_0NjWZqz1TDby1TNwWNDrb` | subscription / month | `vip_subscription` |
| `vip-yearly` | `pdt_0NjWZq3bhAD1lTsmOK0jU` | subscription / year | `vip_subscription` |
| `skin-permanent` | `pdt_0NjWZpRBh70r1nylL6Pjw` | one time | `skin_once` |
| `custom-slot-permanent` | `pdt_0NjWZonG0ci4Cfuk68jmw` | one time | `custom_slot_once` |

本机认证 API `GET /api/products` 为 Web 与 macOS 原生界面提供同一份文案和映射，响应只包含公开产品字段与配置状态：

```json
{
  "ok": true,
  "schemaVersion": 1,
  "provider": "dodo_payments",
  "commerce": {
    "status": "unconfigured",
    "configured": false,
    "checkoutEnabled": false,
    "redemptionEnabled": false,
    "webhookVerificationEnabled": false,
    "productDirectoryEnvironment": "live_mode",
    "reasonCode": "TRUSTED_COMMERCE_UNCONFIGURED"
  },
  "products": []
}
```

响应可以公开 Dodo Product ID，因为它只是商品路由标识，不是凭证。API Key、Webhook Key、数据库 URL、签名密钥引用、授权码、customer/payment/subscription ID 都不得进入响应。客户端即使知道或修改 Product ID，也不能生成 Ed25519 签名租约，因此不能自行解锁。

可信互联网服务的最小环境骨架如下。示例只写变量名，不应把真实值提交到仓库：

```dotenv
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_WEBHOOK_KEY=
DODO_PAYMENTS_ENVIRONMENT=live_mode
SKIN_STUDIO_ENTITLEMENT_DATABASE_URL=
SKIN_STUDIO_LEASE_SIGNING_KEY_REF=
SKIN_STUDIO_CHECKOUT_RETURN_URL=https://account.example.com/checkout/return
SKIN_STUDIO_PUBLIC_BASE_URL=https://account.example.com/
```

`src/products.mjs` 的 readiness 检查要求上述七项同时有效；任一缺失时 `configured=false`、购买和兑换入口关闭，服务端操作返回 `503 COMMERCE_NOT_CONFIGURED`。当前正式目录要求 `DODO_PAYMENTS_ENVIRONMENT=live_mode`；若环境与目录不一致，会在任何 SDK 或数据库调用前拒绝启用。Return URL 必须是无内嵌账号密码的 HTTPS URL，Public Base URL 必须是无 query/hash 的 HTTPS 根 origin。桌面进程不读取或保存这些服务端秘密。

## 商品映射必须由服务端决定

服务端维护 `src/products.mjs` 的只读发布配置。Checkout 不接受任何资源选择；兑换时只有经 Dodo 验证为 `skin_once` 的授权码可以提交 `skinId`，`profileId` 永远由服务端生成：

```json
{
  "vip-monthly": {"offerType": "vip_subscription"},
  "vip-yearly": {"offerType": "vip_subscription"},
  "skin-permanent": {"offerType": "skin_once", "selection": "first_redemption"},
  "custom-slot-permanent": {"offerType": "custom_slot_once", "selection": "first_redemption"}
}
```

当前“单套皮肤”共用一个 Dodo Product。购买阶段只生成不可预测的内部 `orderRef`，并只把该字符串放进 Dodo metadata。首次兑换时，客户端先不传 `skinId`；可信服务确认授权码确属 `skin_once` 后返回 `SELECTION_REQUIRED`。用户再从正式可售 VIP 目录选择一个 `skinId`，服务端校验后写入不可变 binding。以后省略或重复同一值都返回原绑定，任何不同值返回 `409 BINDING_IMMUTABLE`。退款或拒付只撤销使用权，不清空这个历史绑定。

## 服务端最小 API 合约

### `POST /v1/checkouts`

客户端只提交目录 ID和幂等键。Checkout 不接受 `skinId`、Dodo Product ID、价格、offerType、customer ID、权益或回调 URL：

```json
{
  "catalogProductId": "skin-permanent",
  "idempotencyKey": "client-generated-random-id"
}
```

可信服务按以下顺序创建结账：

1. `requireTrustedCommerceConfiguration()` 必须通过，否则返回 `503 COMMERCE_NOT_CONFIGURED`，不生成假 URL。
2. 从 `src/products.mjs` 查询 Product ID并把数量固定为 1；出现任何资源选择字段都拒绝请求。
3. 在数据库创建 `locked_skin_id IS NULL` 的 pending order，并生成不可预测的 `orderRef`；同一个 `(customer, idempotencyKey)` 只能得到一个订单。
4. 服务端使用 `DODO_PAYMENTS_API_KEY` 调用 Dodo [`POST /checkouts`](https://docs.dodopayments.com/api-reference/checkout-sessions/create)，固定 `product_cart=[{product_id, quantity:1}]`、可信 HTTPS `return_url`，metadata 只携带字符串形式的内部 `order_ref`；所有 metadata value 都必须是 string。
5. 部署 adapter 将官方 SDK `checkoutSessions.create()` 的响应归一为 `{sessionId, checkoutUrl}`。`checkout_url` 为 `null`、非 HTTPS、含账号密码或格式错误时必须返回 `502`，不能保存或伪造购买链接。返回页面上的 `status`、`license_key` 或 query string 仅用于展示，不能授予权益。

### `POST /v1/webhooks/dodo`

该公网端点只接受 Dodo Webhook。HTTP 层必须保留原始请求字节；服务层以 fatal UTF-8 解码得到内容完全对应的 raw string；部署 adapter 再调用官方 SDK `client.webhooks.unwrap(rawBodyText, {headers})`：

- `webhook-id`
- `webhook-signature`
- `webhook-timestamp`

Webhook Key 来自 `DODO_PAYMENTS_WEBHOOK_KEY`。缺少 key、缺少任一 header、无效 UTF-8、签名失败或时间窗口不合法时返回 `400/401/503`，不得降级使用 `unsafeUnwrap` / `unsafe_unwrap()`，也不得在验签前 `JSON.parse`。签名通过后，以 `webhook-id UNIQUE` 幂等入库；Dodo 会重试且事件可能乱序，因此状态更新必须比较服务端时间/版本，而不能依赖到达顺序。官方要求以 2xx 确认已接收，耗时的 grant 同步应放入持久队列。参考 [Dodo Webhook security](https://docs.dodopayments.com/developer-resources/webhooks)。

### Dodo 授权码验证边界

Dodo 的 `/licenses/activate`、`/licenses/validate` 和 `/licenses/deactivate` 是无需 API Key 的公开端点；其中 validate 只返回 `valid`，不足以决定灵妆权益。桌面端可以持有授权码，但不能直接把 `valid=true`、activation 返回的 Product ID 或结账回跳参数当成授权。

可信服务必须区分两个绝不混用的标识：授权本身的 `license_key_id`，以及 activation 响应 `id` 所代表的 `license_key_instance_id`。部署 adapter 必须把后者归一为 `licenseKeyInstanceId`，并将 Product ID/customer 与自己的 payment/subscription/order/grant 数据及已验签 Webhook 对账，然后才签发短期租约。VIP 还必须检查订阅当前状态与 `validUntil`；永久商品必须读取已存在的不可变 binding。客户端最终只信任租约签名。本地 `deviceId` 或其 hash 都不是 Dodo instance ID。

服务内 Port 与官方 SDK 一一对应：`createCheckoutSession -> checkoutSessions.create`、`validateLicense -> licenses.validate`、`activateLicense -> licenses.activate`、`deactivateLicense -> licenses.deactivate`。前者使用官方 `product_cart` / `return_url` / string metadata 语义；license Port 由 adapter 在领域 camelCase 与官方 snake_case 之间转换。官方 validate 的 `valid=true` 不包含足够的商业身份，adapter 仍必须完成上述服务端对账。

### `POST /v1/redemptions`

请求：

```json
{
  "licenseKey": "用户输入的 Dodo 授权码",
  "deviceId": "Keychain 中生成的随机设备 ID",
  "clientVersion": "2.0.0",
  "platform": "macos"
}
```

客户端第一次总是不带 `skinId`。只有服务端返回 `SELECTION_REQUIRED` 后，第二次请求才可增加例如 `"skinId":"violet-nebula"`；客户端仍不能据此自行判断授权码类型。

服务端必须按以下顺序处理：

1. 限流并验证 Dodo 授权码，读取可信的 Dodo `product_id` 和购买/订阅状态。
2. 用 `product_id` 查询服务端商品映射；非 `skin_once` 请求出现 `skinId` 时返回 `SKIN_NOT_ALLOWED`，绝不把客户端选择用于 VIP 或自定义位。
3. 在单个数据库事务中以 Dodo license key ID 加锁。
4. 如果已有绑定，只返回原绑定；请求任何不同资源都返回 `409 BINDING_IMMUTABLE`。
5. 如果没有绑定：`skin_once` 缺少选择时返回 `SELECTION_REQUIRED`，有选择时先通过服务端正式可售目录校验，再保存固定 `skinId`；`custom_slot_once` 生成不可预测且固定的 `profileId`；VIP 不创建资源绑定。
6. 以 `(licenseKeyId, deviceHash)` 查找 active device。已有记录时复用其不可变 `licenseKeyInstanceId`；没有记录时调用 Dodo activate，必须取得官方 instance ID 后插入一条新的历史 activation row。设备记录不拥有资源绑定。
7. 汇总该 customer 的全部有效及已撤销 grant，签发新的 schemaVersion 2 租约。

响应：

```json
{
  "ok": true,
  "signedLease": "base64url(payload).base64url(ed25519-signature)",
  "redemption": {
    "offerType": "skin_once",
    "status": "active",
    "binding": {"skinId": "violet-nebula"}
  }
}
```

### `POST /v1/leases/refresh`

验证授权码/登录会话和 active device row，并把该 row 的官方 `licenseKeyInstanceId` 传给 Dodo validate，重新查询 Dodo 状态及本地 grant，返回一份新租约。客户端启动、租约剩余不足 25% 或收到 Webhook 推送提示时刷新；默认租约 24 小时，因此未直接触发撤销的中间态也会在下一次 refresh 重新对账。

### `POST /v1/devices/deactivate`

先用本地 `deviceId` 的 hash 读取 active device row，再把该 row 的不可变 `licenseKeyInstanceId` 传给 Dodo deactivate，最后只停用同一行。绝不能把本地 `deviceId` 冒充 `license_key_instance_id`。该接口不得删除 `redemption_bindings`、不得更改 `bound_resource_id`，也不得给授权码提供重新选择皮肤的机会。停用后再次激活应插入带新 instance ID 的新行，历史行不能被覆盖。

## 数据库不可变约束

下面是 PostgreSQL 的最小约束示意。生产迁移应使用 UUID、外键和审计字段，但必须保留相同的不变量：

```sql
CREATE TABLE redemption_bindings (
  id uuid PRIMARY KEY,
  dodo_license_key_id text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  product_id text NOT NULL,
  offer_type text NOT NULL CHECK (
    offer_type IN ('skin_once', 'custom_slot_once')
  ),
  bound_resource_id text NOT NULL,
  bound_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revoked_at timestamptz,
  CHECK (
    (status = 'active' AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE FUNCTION reject_binding_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.dodo_license_key_id <> OLD.dodo_license_key_id
     OR NEW.product_id <> OLD.product_id
     OR NEW.offer_type <> OLD.offer_type
     OR NEW.bound_resource_id IS DISTINCT FROM OLD.bound_resource_id
     OR NEW.bound_at <> OLD.bound_at THEN
    RAISE EXCEPTION 'BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redemption_binding_is_immutable
BEFORE UPDATE ON redemption_bindings
FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
```

设备表只引用 binding/customer，不拥有 binding：

```sql
CREATE TABLE device_activations (
  id uuid PRIMARY KEY,
  dodo_license_key_id text NOT NULL,
  dodo_license_key_instance_id text NOT NULL UNIQUE,
  device_hash text NOT NULL,
  activated_at timestamptz NOT NULL,
  deactivated_at timestamptz
);

CREATE UNIQUE INDEX device_activations_one_active_device_idx
ON device_activations (dodo_license_key_id, device_hash)
WHERE deactivated_at IS NULL;
```

数据库 Trigger 必须拒绝修改 activation row 已赋值的 `dodo_license_key_instance_id`、license、customer、device hash、platform 和 `activated_at`。这样同一设备在停用后仍可新增历史行，但任何既有官方 instance 都不能被“换绑”。旧表只有本地 device hash 时无法推导官方 instance ID；升级采用 003 expansion（服务停机、允许旧行临时为 null）→ 与 Dodo 对账/回填真实 activation `id` → 004 enforcement（`NOT NULL`）的顺序。004 对任何未对账行 fail closed，不能拿本地 ID 回填，且 003 与 004 之间不得启动新 runtime。

退款、拒付或人工撤销执行 `UPDATE status='revoked', revoked_at=now()`，不能 `DELETE`，也不能清空 `bound_resource_id`。恢复购买时可以把同一行恢复为 active，但仍使用原绑定。

服务实现还应在写库前调用 `src/entitlements.mjs` 导出的 `assertGrantTransition(previous, next, {event})`。它会拒绝修改 `grantId`、商品、offer 类型、资源 binding 或 `boundAt`；`event: 'device_deactivate'` 时则拒绝任何 grant 变化。数据库 Trigger 仍是最终约束，不能只依赖应用层检查。

## 客户端签名租约 schemaVersion 2

实现位于 `src/entitlements.mjs`。顶层字段严格为：

```json
{
  "schemaVersion": 2,
  "licenseId": "lease_opaque_id",
  "audience": "codex-skin-studio",
  "subject": "customer_opaque_id",
  "issuedAt": "2026-07-16T00:00:00Z",
  "notBefore": "2026-07-16T00:00:00Z",
  "expiresAt": "2026-07-17T00:00:00Z",
  "clientIds": ["codex", "workbuddy"],
  "grants": []
}
```

每个 grant 的字段严格为：

```json
{
  "grantId": "grant_opaque_id",
  "offerType": "skin_once",
  "status": "active",
  "productId": "pdt_violet_nebula",
  "binding": {"skinId": "violet-nebula"},
  "boundAt": "2026-07-01T00:00:00Z",
  "validUntil": null,
  "revokedAt": null
}
```

- `vip_subscription`：`binding` 必须为 `null`，`validUntil` 必须是订阅当前有效期结束时间。
- `skin_once`：`binding` 必须且只能包含一个 `skinId`，`validUntil` 必须为 `null`。
- `custom_slot_once`：`binding` 必须且只能包含一个 `profileId`，`validUntil` 必须为 `null`。
- revoked grant 必须保留原 binding，包含 `revokedAt`，但不会进入客户端的 `skinIds` / `customProfileIds` 权限快照。
- `licenseId` 在 v2 中是租约 ID；沿用名称是为了兼容 v1 客户端展示。
- schemaVersion 1 的旧 VIP 离线授权仍可验签，但新服务只签发 schemaVersion 2。

客户端权限计算：

- 有 active 且未过 `validUntil` 的 VIP grant：`tier=vip`，所有功能开启。
- 没有 VIP、但有 active `skin_once`：仍显示免费账户，只能应用 `skinIds` 中的付费皮肤。
- 没有 VIP、但有 active `custom_slot_once`：仍显示免费账户，只能创建/编辑/应用 `customProfileIds` 中对应的自定义皮肤。
- revoked grant、过期 VIP grant、签名被修改或整个租约过期：不授权。

桌面端的 `POST /api/union-profiles` 与 `POST /api/union-profile-drafts` 都不只检查客户端提交的 `id` 是否出现在 `customProfileIds` 快照，还要求同一已验签权益对象的 `activeGrants` 中存在 `offerType=custom_slot_once`、`status=active` 且 `binding.profileId` 完全相同的 grant；VIP 则必须拥有 `allFeatures`。因此伪造请求里的 `profileId`、只保留一份过期快照或拿 `skin_once` 授权都不能持久化另一个自定义位。blocked Agent 的草稿只写入隔离的 `union-profile-drafts/`，不能被应用、排程或注入；免费用户仍只可用 `POST /api/preview` 在内存中试调，预览请求不会创建文件。

## Webhook 与撤销

Webhook 必须验证原始请求签名、以事件 ID 幂等入库，并在事务中更新 grant。事件名采用 Dodo 官方当前文档的精确拼写；旧别名不能继续保留为授权通道。参考：[Webhook events guide](https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide)、[Subscription webhooks](https://docs.dodopayments.com/developer-resources/webhooks/intents/subscription)、[Entitlement grant webhooks](https://docs.dodopayments.com/developer-resources/webhooks/intents/entitlement-grant)、[Dispute webhook](https://docs.dodopayments.com/developer-resources/webhooks/intents/dispute)、[Webhook security](https://docs.dodopayments.com/developer-resources/webhooks)。

| 处理类别 | 精确事件 | 本地动作 |
|---|---|---|
| 付款确认 | `payment.succeeded` | 仅把已锁定的内部订单标为 paid |
| 不可逆撤销 | `refund.succeeded`、`dispute.accepted`、`dispute.lost`、`entitlement_grant.revoked`、`subscription.expired` | grant/binding 状态改为 revoked，永久保留原绑定 |
| 已确认但暂不直接修改 grant | 其它当前官方事件，如 `payment.processing`、`refund.failed`、`subscription.failed`、`subscription.cancelled`、`entitlement_grant.failed` | 验签、幂等记录，`recorded-noop`；由下一次 24h lease refresh validate/对账 |
| 旧名或未知名 | `payment.paid`、`payment.refunded`、`license.revoked` 等 | 验签后只记 `recorded-unsupported`，绝不付款、授权或撤销 |

- VIP 取消但仍在已付周期内：`validUntil` 保留周期末；只有 `subscription.expired` 直接进入不可逆撤销集合。
- `subscription.failed` / `on_hold` 等中间态不直接改写不可变 grant；24 小时租约 refresh 再验证当前订阅和宽限期策略。
- Webhook 重放：`processed_webhook_events(webhook_id PRIMARY KEY)` 保证幂等。
- 撤销后服务端立即使 refresh 返回 revoked grant；现有离线租约最迟在 `expiresAt` 失效。

## 上线安全清单

1. 为三种 offer 创建独立 Dodo Product；每套单卖皮肤有稳定的 product-to-skin 映射。
2. 授权服务、数据库和 Webhook 部署完成后才在客户端显示购买按钮。
3. Ed25519 私钥仅存 KMS/HSM；桌面端只包含独立的权益公钥，不能与 Adapter 更新公钥复用。
4. 租约默认 24 小时，最长不超过 72 小时；服务不可用时展示明确的刷新失败和剩余离线时间。
5. 授权码不得写日志、分析事件或崩溃报告；设备 ID 使用随机值并在服务端哈希。
6. 用数据库并发测试证明同一码同时兑换时只产生一条绑定。
7. 用退款、拒付、订阅到期、官方 instance ID 设备解绑、旧事件 no-op 和 Webhook 重放测试证明绑定不会被删除或换绑。
8. macOS 使用 Keychain 保存授权码；删除本机授权只删除本地凭据，不触发服务端换绑。
