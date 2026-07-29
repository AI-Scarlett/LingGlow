import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {loadRemoteThemeCatalog} from '../src/remote-theme-catalog.mjs';

const catalogFixture = fs.readFileSync(new URL('../release/github-public/catalog/v1/index.json', import.meta.url));

function withCachedCatalog() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-template-sync-'));
  const directory = path.join(dataDir, 'remote-skin-catalog');
  fs.mkdirSync(directory, {mode: 0o700});
  fs.writeFileSync(path.join(directory, 'index.json'), catalogFixture, {mode: 0o600});
  return dataDir;
}

test('automatic template sync uses a verified cache for one hour while manual sync fetches now', {concurrency: false}, async () => {
  const dataDir = withCachedCatalog();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(catalogFixture, {status: 200});
  };
  try {
    const automatic = await loadRemoteThemeCatalog({
      dataDir,
      refresh: 'automatic',
      now: Date.now(),
    });
    assert.ok(automatic.skins.length > 0);
    assert.equal(fetchCalls, 0, 'fresh automatic cache must not start a network sync');

    const manual = await loadRemoteThemeCatalog({
      dataDir,
      refresh: 'manual',
      now: Date.now(),
    });
    assert.ok(manual.skins.length > 0);
    assert.equal(fetchCalls, 1, 'the explicit Sync Templates action must check now');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
});
