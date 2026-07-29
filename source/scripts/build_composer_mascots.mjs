#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'work', 'skin-mascots-rendered');
const ASSET_DIR = path.join(ROOT, 'catalog', 'assets');
const LEGACY_DIR = path.join(ROOT, 'catalog', 'skins');
const PACK_DIR = path.join(ROOT, 'catalog', 'theme-packs');

const LEGACY_IDS = [
  'dream-portal',
  'graphite-focus',
  'ocean-breeze',
  'jade-calm',
  'aurora-glass',
  'sunset-atelier',
  'violet-nebula',
];

const THEME_PACK_IDS = [
  'aurora-free',
  'amber-free',
  'dream-gothic-void',
  'dream-portal-free',
  'messi-argentina',
  'neymar-brazil',
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildMascot(id) {
  const source = path.join(SOURCE_DIR, `${id}.png`);
  const fileName = `${id}-mascot.webp`;
  const output = path.join(ASSET_DIR, fileName);
  if (!fs.existsSync(source)) throw new Error(`Missing transparent mascot source: ${source}`);
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-vf', 'scale=1024:1024:flags=lanczos,format=rgba',
    '-c:v', 'libwebp', '-lossless', '1', '-frames:v', '1',
    output,
  ], {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${id}`);
  return {
    path: `assets/${fileName}`,
    sha256: sha256(output),
  };
}

fs.mkdirSync(ASSET_DIR, {recursive: true});

for (const id of LEGACY_IDS) {
  const asset = buildMascot(id);
  const definitionPath = path.join(LEGACY_DIR, `${id}.json`);
  const definition = readJSON(definitionPath);
  definition.composerAvatarAsset = {
    kind: 'composer-avatar-webp',
    ...asset,
  };
  writeJSON(definitionPath, definition);
  console.log(`built legacy composer mascot: ${id}`);
}

for (const id of THEME_PACK_IDS) {
  const asset = buildMascot(id);
  const definitionPath = path.join(PACK_DIR, `${id}.json`);
  const definition = readJSON(definitionPath);
  const assetId = `${id}-workbuddy-mascot`;
  definition.assets = Object.fromEntries([
    ...Object.entries(definition.assets)
      .filter(([, entry]) => entry.slot !== 'workbuddy.composer-avatar'),
    [assetId, {
      slot: 'workbuddy.composer-avatar',
      ...asset,
    }],
  ]);
  definition.base['workbuddy.composerAvatar.image'] = {assetId};
  definition.base['workbuddy.composerAvatar.fit'] = 'contain';
  definition.base['workbuddy.composerAvatar.shape'] = 'square';
  writeJSON(definitionPath, definition);
  console.log(`built theme-pack composer mascot: ${id}`);
}

const indexPath = path.join(PACK_DIR, 'index.json');
const index = readJSON(indexPath);
index.packs = index.packs.map((entry) => ({
  ...entry,
  sha256: sha256(path.join(ROOT, 'catalog', entry.path)),
}));
writeJSON(indexPath, index);
console.log(`updated ${path.relative(ROOT, indexPath)}`);
