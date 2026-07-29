import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AUTHORIZATION_VAULT_FILE,
  EncryptedAuthorizationVault,
} from '../src/encrypted-authorization-vault.mjs';
import {createDirectDodoCommerceBridge} from '../src/direct-dodo-commerce.mjs';
import {PRODUCT_CATALOG} from '../src/products.mjs';

class MemoryKeychain {
  constructor() {
    this.available = true;
    this.values = new Map();
  }
  key(service, account) { return `${service}\0${account}`; }
  async get(service, account) { return this.values.get(this.key(service, account)) ?? null; }
  async set(service, account, value) { this.values.set(this.key(service, account), value); }
  async delete(service, account) { return this.values.delete(this.key(service, account)); }
}

test('one private AES-GCM file survives a new store instance and contains no plaintext license material', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-encrypted-vault-'));
  const keychainStore = new MemoryKeychain();
  const service = 'com.lingglow.dodo.direct-licenses.v1';
  const account = 'active-licenses-v1';
  const secret = JSON.stringify({schemaVersion: 1, records: [{
    code: 'SECRET-LICENSE-MUST-STAY-ENCRYPTED',
    binding: {skinId: 'agent-codex-terminal-orbit'},
  }]});
  const first = new EncryptedAuthorizationVault({dataDir, keychainStore});
  await first.set(service, account, secret);

  const filePath = path.join(dataDir, AUTHORIZATION_VAULT_FILE);
  const onDisk = fs.readFileSync(filePath, 'utf8');
  assert.equal(onDisk.includes('SECRET-LICENSE-MUST-STAY-ENCRYPTED'), false);
  assert.equal(onDisk.includes('agent-codex-terminal-orbit'), false);
  assert.equal(fs.statSync(filePath).mode & 0o077, 0);
  const parsed = JSON.parse(onDisk);
  assert.equal(parsed.cipher, 'aes-256-gcm');

  const afterUpgrade = new EncryptedAuthorizationVault({dataDir, keychainStore});
  assert.equal(await afterUpgrade.get(service, account), secret);
  assert.equal(keychainStore.values.size, 1, 'only the AES master key remains in Keychain');
});

test('legacy Keychain state is retained until the encrypted file verifies, then removed', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-encrypted-migration-'));
  const keychainStore = new MemoryKeychain();
  const service = 'com.lingglow.dodo.direct-licenses.v1';
  const account = 'active-licenses-v1';
  const legacy = '{"schemaVersion":1,"records":[]}';
  await keychainStore.set(service, account, legacy);
  const vault = new EncryptedAuthorizationVault({dataDir, keychainStore});
  assert.equal(await vault.get(service, account), legacy);
  assert.equal(fs.existsSync(path.join(dataDir, AUTHORIZATION_VAULT_FILE)), false);

  await vault.set(service, account, legacy);
  assert.equal(await keychainStore.get(service, account), null);
  assert.equal(await vault.get(service, account), legacy);
});

test('tampering and missing master keys fail closed, while delete removes local authorization material', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-encrypted-tamper-'));
  const keychainStore = new MemoryKeychain();
  const service = 'com.lingglow.dodo.direct-licenses.v1';
  const account = 'active-licenses-v1';
  const vault = new EncryptedAuthorizationVault({dataDir, keychainStore});
  await vault.set(service, account, '{"schemaVersion":1,"records":[]}');
  const filePath = path.join(dataDir, AUTHORIZATION_VAULT_FILE);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  value.ciphertext = `${value.ciphertext.slice(0, -1)}${value.ciphertext.endsWith('A') ? 'B' : 'A'}`;
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, {mode: 0o600});
  await assert.rejects(() => vault.get(service, account),
    (error) => ['AUTHORIZATION_VAULT_INVALID', 'AUTHORIZATION_VAULT_DECRYPT_FAILED'].includes(error.code));

  await vault.set(service, account, '{"schemaVersion":1,"records":[]}');
  assert.equal(await vault.delete(service, account), true);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(keychainStore.values.size, 0);
});

test('Dodo receives one stable anonymous device name and a missing vault recovers the same activation', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-device-recovery-'));
  const keychainStore = new MemoryKeychain();
  const product = PRODUCT_CATALOG.find((candidate) => candidate.offerType === 'skin_once');
  const calls = [];
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    const body = JSON.parse(options.body);
    calls.push({pathname, body});
    if (pathname.endsWith('/activate')) {
      return new Response(JSON.stringify({
        id: 'activation-instance-stable-device',
        license_key_id: 'license-record-stable-device',
        product: {product_id: product.dodoProductId},
      }), {status: 201, headers: {'content-type': 'application/json'}});
    }
    assert.match(pathname, /\/validate$/u);
    assert.equal(body.license_key_instance_id, 'activation-instance-stable-device');
    return new Response(JSON.stringify({valid: true}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  };
  const code = 'TEST-SAME-MAC-RECOVERY-LICENSE';
  const first = createDirectDodoCommerceBridge({
    dataDir,
    keychainStore,
    fetchImpl,
    clock: () => new Date('2026-07-24T08:00:00.000Z'),
  });
  await first.redeem({licenseKey: code, skinId: 'agent-codex-terminal-orbit'});
  assert.match(calls[0].body.name, /^LingGlow macOS \[lgd_[A-Za-z0-9_-]{16}\]$/u);
  assert.equal(calls.filter((call) => call.pathname.endsWith('/activate')).length, 1);

  fs.unlinkSync(path.join(dataDir, AUTHORIZATION_VAULT_FILE));
  const afterReinstall = createDirectDodoCommerceBridge({
    dataDir,
    keychainStore,
    fetchImpl,
    clock: () => new Date('2026-07-24T09:00:00.000Z'),
  });
  await afterReinstall.redeem({licenseKey: code, skinId: 'agent-codex-terminal-orbit'});
  assert.equal(calls.filter((call) => call.pathname.endsWith('/activate')).length, 1,
    'same Mac validates its saved License Instance instead of creating another device activation');
  assert.equal(calls.filter((call) => call.pathname.endsWith('/validate')).length, 1);
  assert.deepEqual(afterReinstall.currentEntitlement().skinIds, ['agent-codex-terminal-orbit']);
  assert.equal(await first.anonymousDeviceName(), await afterReinstall.anonymousDeviceName());
  assert.equal(fs.existsSync(path.join(dataDir, AUTHORIZATION_VAULT_FILE)), true);
  const keychainText = [...keychainStore.values.values()].join('\n');
  assert.equal(keychainText.includes(code), false, 'recovery index never contains the raw license key');
});
