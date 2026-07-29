import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  loadThemePackRegistry,
} from '../src/catalog/theme-pack.mjs';

function staticWebPDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', `${filePath}: RIFF`);
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', `${filePath}: WEBP`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 'ANIM' || type === 'ANMF') assert.fail(`${filePath}: animated WebP`);
    if (type === 'VP8X') {
      return {
        width: buffer.readUIntLE(start + 4, 3) + 1,
        height: buffer.readUIntLE(start + 7, 3) + 1,
      };
    }
    if (type === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(start + 6) & 0x3fff,
        height: buffer.readUInt16LE(start + 8) & 0x3fff,
      };
    }
    if (type === 'VP8L') {
      const bits = buffer.readUInt32LE(start + 1);
      return {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1};
    }
    offset = start + size + (size % 2);
  }
  assert.fail(`${filePath}: missing WebP image chunk`);
}

function lockedAsset(pack, fieldId) {
  const assetId = pack.base[fieldId]?.assetId;
  assert.ok(assetId, `${pack.id}: missing ${fieldId}`);
  const asset = pack.assets[assetId];
  assert.ok(asset, `${pack.id}: missing asset ${assetId}`);
  const filePath = path.join(DEFAULT_THEME_PACK_CATALOG_DIR, asset.path);
  const digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  assert.equal(digest, asset.sha256, `${pack.id}: ${assetId} SHA-256`);
  return {...asset, assetId, filePath, dimensions: staticWebPDimensions(filePath)};
}

test('all Theme Packs keep 16:9 Agent heroes separate from the Codex 3:1 banner', () => {
  const {packs} = loadThemePackRegistry();
  assert.equal(packs.length, 32);

  for (const pack of packs) {
    const background = lockedAsset(pack, 'background.image');
    const workbuddy = lockedAsset(pack, 'workbuddy.projectHero.image');
    const codex = lockedAsset(pack, 'codex.banner.image');
    const doubao = lockedAsset(pack, 'doubao.homeHero.image');

    assert.deepEqual(workbuddy.dimensions, {width: 1920, height: 1080},
      `${pack.id}: WorkBuddy Home Hero must be 1920x1080`);
    assert.deepEqual(doubao.dimensions, {width: 1920, height: 1080},
      `${pack.id}: Doubao Home Hero must be 1920x1080`);
    assert.ok(Math.abs(codex.dimensions.width / codex.dimensions.height - 3) <= 0.015,
      `${pack.id}: Codex banner must stay 3:1`);

    assert.equal(workbuddy.path, doubao.path,
      `${pack.id}: WorkBuddy and Doubao may share the dedicated 16:9 crop`);
    assert.equal(workbuddy.sha256, doubao.sha256,
      `${pack.id}: shared 16:9 crop must be byte-identical`);
    assert.notEqual(codex.path, workbuddy.path,
      `${pack.id}: Codex banner must not reuse the 16:9 crop`);
    assert.notEqual(codex.sha256, workbuddy.sha256,
      `${pack.id}: Codex banner must not reuse the 16:9 bytes`);
    assert.notEqual(background.sha256, codex.sha256,
      `${pack.id}: Codex banner must differ from the global background`);
    assert.notEqual(background.sha256, workbuddy.sha256,
      `${pack.id}: 16:9 crop must differ from the global background`);
  }
});
