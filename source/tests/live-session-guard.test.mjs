import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refuseManagedLiveSession} from './helpers/live-session-guard.mjs';

test('real-client QA guard is present and requires an explicit active-session override', () => {
  const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers/live-session-guard.mjs'),
    'utf8',
  );
  assert.match(source, /session\?\.state === 'active' \|\| session\?\.mode/u);
  assert.match(source, /LINGGLOW_LIVE_QA_REPLACE_ACTIVE/u);
  assert.match(source, /真实客户端测试已拒绝覆盖/u);
});

test('real-client QA guard can be explicitly bypassed without reading user state', async () => {
  const previous = process.env.LINGGLOW_LIVE_QA_REPLACE_ACTIVE;
  process.env.LINGGLOW_LIVE_QA_REPLACE_ACTIVE = '1';
  try {
    await assert.doesNotReject(() => refuseManagedLiveSession('workbuddy'));
  } finally {
    if (previous === undefined) delete process.env.LINGGLOW_LIVE_QA_REPLACE_ACTIVE;
    else process.env.LINGGLOW_LIVE_QA_REPLACE_ACTIVE = previous;
  }
});
