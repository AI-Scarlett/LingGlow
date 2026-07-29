import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICNS = path.join(ROOT, 'native', 'Resources', 'LingGlowAppIcon.icns');
const SOURCE_PNG = path.join(ROOT, 'native', 'Resources', 'LingGlowAppIcon-1024.png');
const MENU_TEMPLATE = path.join(ROOT, 'native', 'Resources', 'LingGlowMenuBarTemplate.svg');
const PNG_SIGNATURE = '89504e470d0a1a0a';

const expectedChunks = new Map([
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
]);

function parsePngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function inspectSourceAlpha() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-icon-test-'));
  const bitmapPath = path.join(directory, 'icon.bmp');
  try {
    const metadata = execFileSync('/usr/bin/sips', ['-g', 'hasAlpha', SOURCE_PNG], {encoding: 'utf8'});
    assert.match(metadata, /hasAlpha:\s*yes/u);
    execFileSync('/usr/bin/sips', ['-Z', '64', '-s', 'format', 'bmp', SOURCE_PNG, '--out', bitmapPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const bitmap = fs.readFileSync(bitmapPath);
    const pixelOffset = bitmap.readUInt32LE(10);
    const width = bitmap.readInt32LE(18);
    const height = Math.abs(bitmap.readInt32LE(22));
    assert.deepEqual([width, height], [64, 64]);
    assert.equal(bitmap.readUInt16LE(28), 32);
    assert.equal(bitmap.readUInt32LE(66), 0xff000000);

    const alphaAt = (x, y) => bitmap[pixelOffset + (y * width + x) * 4 + 3];
    const alphas = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) alphas.push({x, y, alpha: alphaAt(x, y)});
    }
    const occupied = alphas.filter(({alpha}) => alpha >= 32);
    const transparent = alphas.filter(({alpha}) => alpha <= 8);
    const xs = occupied.map(({x}) => x);
    const ys = occupied.map(({y}) => y);
    assert.ok(transparent.length / alphas.length >= 0.2, '图标外圈必须保留足够透明安全区');
    assert.ok(Math.min(...xs) >= 4 && Math.min(...ys) >= 4, '图标上/左视觉占位过大');
    assert.ok(Math.max(...xs) <= 59 && Math.max(...ys) <= 59, '图标下/右视觉占位过大');
    assert.ok(alphaAt(0, 0) <= 8 && alphaAt(63, 0) <= 8 && alphaAt(0, 63) <= 8 && alphaAt(63, 63) <= 8,
      '四角必须透明，不能继续使用满幅正方形');
    assert.ok(alphaAt(32, 32) >= 240, '图标中心必须保持可见');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

test('LingGlow ships independent, complete app and menu-bar icon assets', () => {
  const source = fs.readFileSync(SOURCE_PNG);
  assert.deepEqual(parsePngSize(source), [1024, 1024]);
  inspectSourceAlpha();

  const icns = fs.readFileSync(ICNS);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  const seen = new Map();
  let offset = 8;
  while (offset < icns.length) {
    assert.ok(offset + 8 <= icns.length);
    const type = icns.toString('ascii', offset, offset + 4);
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length > 8);
    assert.ok(offset + length <= icns.length);
    assert.equal(seen.has(type), false, `重复 ICNS chunk：${type}`);
    const png = icns.subarray(offset + 8, offset + length);
    seen.set(type, parsePngSize(png));
    offset += length;
  }
  assert.equal(offset, icns.length);
  assert.deepEqual([...seen.keys()], [...expectedChunks.keys()]);
  for (const [type, expectedSize] of expectedChunks) {
    assert.deepEqual(seen.get(type), [expectedSize, expectedSize], type);
  }

  const menuSvg = fs.readFileSync(MENU_TEMPLATE, 'utf8');
  assert.match(menuSvg, /<svg[^>]+width="18"[^>]+height="18"/u);
  assert.match(menuSvg, /LingGlow menu bar template/u);
  assert.doesNotMatch(menuSvg, /(?:\b(?:href|xlink:href|src)\s*=|<image\b|<script\b|javascript:|data:)/iu);
});
