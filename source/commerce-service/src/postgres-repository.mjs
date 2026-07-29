import crypto from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {commerceError} from './errors.mjs';

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('PostgreSQL 返回了无效时间');
  return date.toISOString();
}

function checkout(row) {
  return row ? {
    id: row.id,
    orderRef: row.order_ref,
    customerId: row.customer_id,
    catalogProductId: row.catalog_product_id,
    dodoProductId: row.dodo_product_id,
    offerType: row.offer_type,
    lockedSkinId: row.locked_skin_id,
    idempotencyKeyHash: row.idempotency_key_hash,
    requestHash: row.request_hash,
    status: row.status,
    checkoutSessionId: row.dodo_checkout_session_id,
    checkoutUrl: row.checkout_url,
    paidAt: iso(row.paid_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  } : null;
}

function binding(row) {
  return row ? {
    id: row.binding_id ?? row.id,
    licenseKeyId: row.dodo_license_key_id,
    customerId: row.customer_id,
    productId: row.product_id,
    offerType: row.offer_type,
    boundResourceId: row.bound_resource_id,
    boundAt: iso(row.bound_at),
    status: row.binding_status ?? row.status,
    revokedAt: iso(row.binding_revoked_at ?? row.revoked_at),
  } : null;
}

function grantRecord(row) {
  if (!row) return null;
  const grantBinding = row.offer_type === 'skin_once'
    ? {skinId: row.bound_resource_id}
    : row.offer_type === 'custom_slot_once'
      ? {profileId: row.bound_resource_id}
      : null;
  return {
    licenseKeyId: row.dodo_license_key_id,
    customerId: row.customer_id,
    grant: {
      grantId: row.grant_id,
      offerType: row.offer_type,
      status: row.status,
      productId: row.product_id,
      binding: grantBinding,
      boundAt: iso(row.bound_at),
      validUntil: iso(row.valid_until),
      revokedAt: iso(row.revoked_at),
    },
  };
}

function identity(row) {
  return row ? {
    id: row.id,
    licenseKeyHash: row.license_key_hash,
    licenseKeyId: row.dodo_license_key_id,
    customerId: row.customer_id,
    productId: row.product_id,
    source: row.source,
    paymentId: row.payment_id,
    subscriptionId: row.subscription_id,
    firstSeenAt: iso(row.first_seen_at),
  } : null;
}

function device(row) {
  return row ? {
    id: row.id,
    licenseKeyId: row.dodo_license_key_id,
    dodoLicenseKeyInstanceId: row.dodo_license_key_instance_id,
    customerId: row.customer_id,
    deviceHash: row.device_hash,
    clientVersion: row.client_version,
    platform: row.platform,
    activatedAt: iso(row.activated_at),
    deactivatedAt: iso(row.deactivated_at),
  } : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function pgError(error, fallbackCode = 'DATABASE_UNAVAILABLE') {
  if (error?.httpStatus && error?.code && !/^[0-9A-Z]{5}$/u.test(error.code)) return error;
  if (error?.code === '23505' || error?.code === '23514') {
    return commerceError('BINDING_IMMUTABLE', 409, '数据库拒绝了不可变绑定变更', {cause: error});
  }
  return commerceError(fallbackCode, 503, '可信数据库暂不可用', {cause: error});
}

export function createPostgresRepository({pool} = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('缺少 node-postgres Pool');
  }
  const transactions = new AsyncLocalStorage();
  const executor = () => transactions.getStore() ?? pool;

  async function query(text, values = []) {
    try {
      return await executor().query(text, values);
    } catch (error) {
      throw pgError(error);
    }
  }

  async function transaction(callback) {
    if (transactions.getStore()) return callback();
    const client = await pool.connect().catch((error) => { throw pgError(error); });
    try {
      await client.query('BEGIN');
      const result = await transactions.run(client, callback);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw pgError(error);
    } finally {
      client.release();
    }
  }

  async function audit({eventType, actorId = null, subjectType, subjectId, details = {}}) {
    await query(`
      INSERT INTO audit_events
        (id, event_type, actor_type, actor_id_hash, subject_type, subject_id, details, created_at)
      VALUES ($1, $2, 'service', $3, $4, $5, $6::jsonb, clock_timestamp())
    `, [crypto.randomUUID(), eventType, actorId === null ? null : sha256(actorId),
      subjectType, subjectId, JSON.stringify(details)]);
  }

  const repository = {
    configured: true,
    adapterName: 'PostgreSQL repository',

    async ping() {
      await query('SELECT 1 AS ok');
      return true;
    },

    async close() {
      if (typeof pool.end === 'function') await pool.end();
    },

    async createOrGetCheckoutOrder(input) {
      return transaction(async () => {
        const inserted = await query(`
          INSERT INTO checkout_orders
            (id, order_ref, customer_id, catalog_product_id, dodo_product_id, offer_type,
             locked_skin_id, idempotency_key_hash, request_hash, status, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$10)
          ON CONFLICT (customer_id, idempotency_key_hash) DO NOTHING
          RETURNING *
        `, [input.id, input.orderRef, input.customerId, input.catalogProductId, input.dodoProductId,
          input.offerType, input.lockedSkinId, input.idempotencyKeyHash, input.requestHash, input.createdAt]);
        if (inserted.rowCount === 1) {
          await audit({eventType: 'checkout.created', actorId: input.customerId,
            subjectType: 'checkout_order', subjectId: input.orderRef});
          return {created: true, order: checkout(inserted.rows[0])};
        }
        const existing = await query(`
          SELECT * FROM checkout_orders
          WHERE customer_id = $1 AND idempotency_key_hash = $2
          FOR UPDATE
        `, [input.customerId, input.idempotencyKeyHash]);
        if (existing.rowCount !== 1) throw commerceError('IDEMPOTENCY_IN_PROGRESS', 409, '幂等请求正在处理');
        if (existing.rows[0].request_hash !== input.requestHash) {
          throw commerceError('IDEMPOTENCY_CONFLICT', 409, '幂等键已经用于不同请求');
        }
        return {created: false, order: checkout(existing.rows[0])};
      });
    },

    async completeCheckoutOrder({orderRef, sessionId, checkoutUrl, updatedAt}) {
      const result = await query(`
        UPDATE checkout_orders
        SET status = 'checkout_created', dodo_checkout_session_id = $2, checkout_url = $3, updated_at = $4
        WHERE order_ref = $1 AND status IN ('pending', 'checkout_created')
        RETURNING *
      `, [orderRef, sessionId, checkoutUrl, updatedAt]);
      if (result.rowCount !== 1) throw commerceError('ORDER_NOT_FOUND', 404, '订单不存在或状态不允许创建结账');
      await audit({eventType: 'checkout.session_created', subjectType: 'checkout_order', subjectId: orderRef});
      return checkout(result.rows[0]);
    },

    async markOrderPaid({orderRef, occurredAt}) {
      const result = await query(`
        UPDATE checkout_orders
        SET status = 'paid', paid_at = COALESCE(paid_at, $2), updated_at = GREATEST(updated_at, $2)
        WHERE order_ref = $1 AND status IN ('pending', 'checkout_created', 'paid')
        RETURNING *
      `, [orderRef, occurredAt]);
      if (result.rowCount !== 1) throw commerceError('ORDER_NOT_FOUND', 404, '找不到可付款订单');
      await audit({eventType: 'checkout.paid', subjectType: 'checkout_order', subjectId: orderRef});
      return checkout(result.rows[0]);
    },

    async findPaidOrder({orderRef, customerId, dodoProductId}) {
      const result = await query(`
        SELECT * FROM checkout_orders
        WHERE order_ref = $1 AND customer_id = $2 AND dodo_product_id = $3 AND status = 'paid'
      `, [orderRef, customerId, dodoProductId]);
      return checkout(result.rows[0] ?? null);
    },

    async withLicenseLock(lockIdentity, callback) {
      return transaction(async () => {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockIdentity]);
        return callback();
      });
    },

    async findLicenseIdentityByKeyHash(keyHash) {
      const result = await query('SELECT * FROM dodo_license_identities WHERE license_key_hash = $1', [keyHash]);
      return identity(result.rows[0] ?? null);
    },

    async findLicenseIdentityByPurchaseReference({paymentId = null, subscriptionId = null} = {}) {
      if ((paymentId === null) === (subscriptionId === null)) {
        throw commerceError('PURCHASE_REFERENCE_INVALID', 500, '付款或订阅引用必须且只能提供一个');
      }
      const column = paymentId === null ? 'subscription_id' : 'payment_id';
      const value = paymentId === null ? subscriptionId : paymentId;
      const result = await query(`SELECT * FROM dodo_license_identities WHERE ${column} = $1`, [value]);
      if (result.rowCount > 1) {
        throw commerceError('PURCHASE_REFERENCE_AMBIGUOUS', 503, '付款或订阅引用不是唯一映射');
      }
      return identity(result.rows[0] ?? null);
    },

    async createLicenseIdentity(input) {
      try {
        const result = await query(`
          INSERT INTO dodo_license_identities
            (id, license_key_hash, dodo_license_key_id, customer_id, product_id, source,
             payment_id, subscription_id, first_seen_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING *
        `, [input.id, input.licenseKeyHash, input.licenseKeyId, input.customerId, input.productId,
          input.source, input.paymentId, input.subscriptionId, input.firstSeenAt]);
        await audit({eventType: 'license.identity_recorded', actorId: input.customerId,
          subjectType: 'dodo_license_key', subjectId: input.licenseKeyId});
        return identity(result.rows[0]);
      } catch (error) {
        if (error?.code === 'BINDING_IMMUTABLE') throw error;
        throw pgError(error, 'LICENSE_IDENTITY_STORE_FAILED');
      }
    },

    async findGrantByLicenseKeyId(licenseKeyId) {
      const result = await query(`
        SELECT g.*, b.bound_resource_id
        FROM entitlement_grants g
        LEFT JOIN redemption_bindings b ON b.id = g.binding_id
        WHERE g.dodo_license_key_id = $1
      `, [licenseKeyId]);
      return grantRecord(result.rows[0] ?? null);
    },

    async createGrant(record) {
      const grant = record.grant;
      const result = await query(`
        INSERT INTO entitlement_grants
          (id, grant_id, dodo_license_key_id, customer_id, product_id, offer_type, binding_id,
           status, bound_at, valid_until, revoked_at, created_at, updated_at)
        VALUES (
          $1,$2,$3,$4,$5,$6,
          CASE WHEN $6 = 'vip_subscription' THEN NULL ELSE
            (SELECT id FROM redemption_bindings WHERE dodo_license_key_id = $3)
          END,
          $7,$8,$9,$10,$8,$8
        )
        RETURNING *
      `, [crypto.randomUUID(), grant.grantId, record.licenseKeyId, record.customerId, grant.productId,
        grant.offerType, grant.status, grant.boundAt, grant.validUntil, grant.revokedAt]);
      await audit({eventType: 'grant.created', actorId: record.customerId,
        subjectType: 'entitlement_grant', subjectId: grant.grantId});
      return repository.findGrantByLicenseKeyId(result.rows[0].dodo_license_key_id);
    },

    async updateGrant({licenseKeyId, grant}) {
      // Revocation is terminal and may commit from a webhook transaction that
      // does not hold the license lock, so a stale read must never rewrite it.
      const result = await query(`
        UPDATE entitlement_grants
        SET status = $2, valid_until = $3, revoked_at = $4, updated_at = clock_timestamp()
        WHERE dodo_license_key_id = $1 AND status <> 'revoked'
        RETURNING grant_id
      `, [licenseKeyId, grant.status, grant.validUntil, grant.revokedAt]);
      if (result.rowCount !== 1) {
        const current = await repository.findGrantByLicenseKeyId(licenseKeyId);
        if (current?.grant.status === 'revoked') {
          throw commerceError('GRANT_REVOKED', 403, 'grant 已经撤销，不能再更新');
        }
        throw commerceError('GRANT_NOT_FOUND', 404, 'grant 不存在');
      }
      await audit({eventType: 'grant.updated', subjectType: 'entitlement_grant', subjectId: result.rows[0].grant_id});
      return repository.findGrantByLicenseKeyId(licenseKeyId);
    },

    async findBindingByLicenseKeyId(licenseKeyId) {
      const result = await query(`
        SELECT id AS binding_id, *, status AS binding_status, revoked_at AS binding_revoked_at
        FROM redemption_bindings WHERE dodo_license_key_id = $1
      `, [licenseKeyId]);
      return binding(result.rows[0] ?? null);
    },

    async createBinding(input) {
      const result = await query(`
        INSERT INTO redemption_bindings
          (id, dodo_license_key_id, customer_id, product_id, offer_type, bound_resource_id,
           bound_at, status, revoked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id AS binding_id, *, status AS binding_status, revoked_at AS binding_revoked_at
      `, [input.id, input.licenseKeyId, input.customerId, input.productId, input.offerType,
        input.boundResourceId, input.boundAt, input.status, input.revokedAt]);
      await audit({eventType: 'binding.created', actorId: input.customerId,
        subjectType: 'redemption_binding', subjectId: input.licenseKeyId});
      return binding(result.rows[0]);
    },

    async findActiveDevice({licenseKeyId, deviceHash}) {
      const result = await query(`
        SELECT * FROM device_activations
        WHERE dodo_license_key_id = $1 AND device_hash = $2 AND deactivated_at IS NULL
      `, [licenseKeyId, deviceHash]);
      return device(result.rows[0] ?? null);
    },

    async activateDevice(input) {
      const result = await query(`
        INSERT INTO device_activations
          (id, dodo_license_key_id, dodo_license_key_instance_id, customer_id, device_hash,
           client_version, platform, activated_at, deactivated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
        RETURNING *
      `, [input.id, input.licenseKeyId, input.dodoLicenseKeyInstanceId, input.customerId,
        input.deviceHash, input.clientVersion, input.platform, input.activatedAt]);
      await audit({eventType: 'device.activated', actorId: input.customerId,
        subjectType: 'device_activation', subjectId: input.dodoLicenseKeyInstanceId});
      return device(result.rows[0]);
    },

    async deactivateDevice({licenseKeyId, deviceHash, dodoLicenseKeyInstanceId, deactivatedAt}) {
      const result = await query(`
        UPDATE device_activations
        SET deactivated_at = $4
        WHERE dodo_license_key_id = $1 AND device_hash = $2
          AND dodo_license_key_instance_id = $3 AND deactivated_at IS NULL
        RETURNING id
      `, [licenseKeyId, deviceHash, dodoLicenseKeyInstanceId, deactivatedAt]);
      if (result.rowCount === 1) {
        await audit({eventType: 'device.deactivated', subjectType: 'device_activation',
          subjectId: dodoLicenseKeyInstanceId});
      }
      return result.rowCount === 1;
    },

    async listGrantsByCustomer(customerId) {
      const result = await query(`
        SELECT g.*, b.bound_resource_id
        FROM entitlement_grants g
        LEFT JOIN redemption_bindings b ON b.id = g.binding_id
        WHERE g.customer_id = $1
        ORDER BY g.created_at, g.grant_id
      `, [customerId]);
      return result.rows.map(grantRecord);
    },

    async withWebhookEvent(metadata, callback) {
      return transaction(async () => {
        const inserted = await query(`
          INSERT INTO processed_webhook_events
            (webhook_id, event_type, occurred_at, payload_sha256, received_at)
          VALUES ($1,$2,$3,$4,clock_timestamp())
          ON CONFLICT (webhook_id) DO NOTHING
          RETURNING webhook_id
        `, [metadata.webhookId, metadata.eventType, metadata.occurredAt, metadata.payloadSha256]);
        if (inserted.rowCount === 0) return {duplicate: true, result: null};
        const result = await callback();
        await query(`
          UPDATE processed_webhook_events SET processed_at = clock_timestamp()
          WHERE webhook_id = $1
        `, [metadata.webhookId]);
        await audit({eventType: 'webhook.processed', subjectType: 'webhook', subjectId: metadata.webhookId,
          details: {providerEventType: metadata.eventType}});
        return {duplicate: false, result};
      });
    },

    async revokeGrantByLicenseKeyId({licenseKeyId, revokedAt, eventType, transitionGuard}) {
      return transaction(async () => {
        const before = await repository.findGrantByLicenseKeyId(licenseKeyId);
        if (!before || before.grant.status === 'revoked') return before;
        // A delayed provider event can carry a timestamp older than the local
        // binding; leases require revokedAt to stay inside the grant lifetime.
        const revokedFrom = Date.parse(revokedAt) < Date.parse(before.grant.boundAt)
          ? before.grant.boundAt : revokedAt;
        const next = {...before.grant, status: 'revoked', revokedAt: revokedFrom};
        transitionGuard(before.grant, next, {event: eventType});
        await query(`
          UPDATE entitlement_grants
          SET status = 'revoked', revoked_at = $2, updated_at = clock_timestamp()
          WHERE dodo_license_key_id = $1
        `, [licenseKeyId, revokedFrom]);
        await query(`
          UPDATE redemption_bindings
          SET status = 'revoked', revoked_at = $2
          WHERE dodo_license_key_id = $1 AND status = 'active'
        `, [licenseKeyId, revokedFrom]);
        await audit({eventType: 'grant.revoked', subjectType: 'dodo_license_key', subjectId: licenseKeyId,
          details: {providerEventType: eventType}});
        return repository.findGrantByLicenseKeyId(licenseKeyId);
      });
    },
  };

  return Object.freeze(repository);
}

export const postgresRepositoryInternals = Object.freeze({checkout, binding, grantRecord, identity, device});
