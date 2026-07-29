import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const catalog = JSON.parse(fs.readFileSync(
  new URL('../release/github-public/catalog/v1/index.json', import.meta.url),
  'utf8',
));
const publishedCatalog = JSON.parse(fs.readFileSync(
  new URL('../dist/github/LingGlow/catalog/v1/index.json', import.meta.url),
  'utf8',
));

function featuredIds(series) {
  return catalog.skins
    .filter((skin) => skin.series === series && skin.tags.includes('featured'))
    .map((skin) => skin.id)
    .sort();
}

test('recommended Agent skins are Codex, Claude, and OpenClaw only', () => {
  assert.deepEqual(featuredIds('agent-cli'), [
    'agent-claude-code-clay',
    'agent-codex-terminal-orbit',
    'agent-openclaw-gateway',
  ]);
});

test('recommended Baxian skins are limited to four representative characters', () => {
  assert.deepEqual(featuredIds('baxian-movie'), [
    'baxian-he-xiangu',
    'baxian-lu-dongbin',
    'baxian-tieguai-li',
    'baxian-zhongli-quan',
  ]);
});

test('recommendation-only catalog update preserves every published package pointer and hash', () => {
  const publishedById = new Map(publishedCatalog.skins.map((skin) => [skin.id, skin.package]));
  assert.equal(catalog.skins.length, publishedById.size);
  for (const skin of catalog.skins) {
    assert.deepEqual(skin.package, publishedById.get(skin.id), skin.id);
  }
});
