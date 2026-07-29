import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = fs.readFileSync(path.join(root, 'native', 'Sources', 'Models.swift'), 'utf8');
const views = fs.readFileSync(path.join(root, 'native', 'Sources', 'Views.swift'), 'utf8');
const support = fs.readFileSync(path.join(root, 'native', 'Sources', 'ContactSupport.swift'), 'utf8');

test('native sidebar exposes a GitHub-backed consultation page for group and private support', () => {
  assert.match(models, /case support[\s\S]*case \.support: return LingGlowL10n\.string\("咨询"\)/u);
  assert.match(views, /sidebarButton\(\.support,[\s\S]*cachedPage\(\.support\)[\s\S]*ContactSupportView/u);
  assert.match(views, /code\.id == "group"[\s\S]*交流群[\s\S]*一对一/u);
  assert.match(views, /supportEmail = "jadename\.zhou@gmail\.com"[\s\S]*mailto:jadename\.zhou@gmail\.com/u);
  assert.match(views, /NSPasteboard\.general\.setString\(supportEmail, forType: \.string\)[\s\S]*emailCopied = true/u);
});

test('consultation QR binaries are never bundled or embedded and only one GitHub manifest URL is fixed', () => {
  assert.match(support,
    /https:\/\/raw\.githubusercontent\.com\/AI-Scarlett\/LingGlow\/main\/public\/support\/contact-qr\.json/u);
  assert.doesNotMatch(support, /wechat-(?:group|private)\.jpg/u);
  assert.doesNotMatch(support, /base64|Data\(base64Encoded/u);
  const resources = path.join(root, 'native', 'Resources');
  const bundledQRs = fs.readdirSync(resources).filter((name) => /(?:qr|wechat).+\.(?:jpg|jpeg|png)$/iu.test(name));
  assert.deepEqual(bundledQRs, []);
});

test('remote consultation images are repository-pinned, size-bounded, hash-verified, and cached', () => {
  assert.match(support, /trustedImagePrefix = "\/AI-Scarlett\/LingGlow\/main\/public\/support\/"/u);
  assert.match(support, /maximumImageBytes = 1 \* 1024 \* 1024/u);
  assert.match(support, /digest\(downloaded\) == item\.sha256/u);
  assert.match(support, /support-contact-cache/u);
  assert.match(support, /allowNetwork: false/u);
});
