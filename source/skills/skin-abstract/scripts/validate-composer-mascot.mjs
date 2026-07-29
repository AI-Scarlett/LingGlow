#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {execFileSync} from 'node:child_process';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const MAX_PIXELS = 4_000_000;
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.25;

function inspectAlphaBitmap(filePath, directory) {
  const bitmapPath = path.join(directory, 'subject-preview.bmp');
  execFileSync('/usr/bin/sips', ['-Z', '64', '-s', 'format', 'bmp', filePath, '--out', bitmapPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  const bitmap = fs.readFileSync(bitmapPath);
  if (bitmap.length < 138 || bitmap.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('预览不是有效 BMP');
  }

  const pixelOffset = bitmap.readUInt32LE(10);
  const dibSize = bitmap.readUInt32LE(14);
  const width = bitmap.readInt32LE(18);
  const height = Math.abs(bitmap.readInt32LE(22));
  const planes = bitmap.readUInt16LE(26);
  const bitsPerPixel = bitmap.readUInt16LE(28);
  const compression = bitmap.readUInt32LE(30);
  if (dibSize < 108 || width < 1 || height < 1 || width > 64 || height > 64 ||
      planes !== 1 || bitsPerPixel !== 32 || compression !== 3 ||
      bitmap.readUInt32LE(54) !== 0x00ff0000 ||
      bitmap.readUInt32LE(58) !== 0x0000ff00 ||
      bitmap.readUInt32LE(62) !== 0x000000ff ||
      bitmap.readUInt32LE(66) !== 0xff000000) {
    throw new Error('预览像素格式不受支持');
  }

  const rowBytes = width * 4;
  if (pixelOffset < 14 + dibSize || pixelOffset + rowBytes * height !== bitmap.length) {
    throw new Error('预览像素数据不完整');
  }

  const total = width * height;
  const paddingX = Math.max(2, Math.floor(width * 0.03));
  const paddingY = Math.max(2, Math.floor(height * 0.03));
  let transparent = 0;
  let occupied = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = bitmap[pixelOffset + y * rowBytes + x * 4 + 3];
      if (alpha <= 8) transparent += 1;
      if (alpha >= 32) {
        occupied += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
  }

  const minimumOccupied = Math.max(16, Math.floor(total * 0.03));
  const minimumTransparent = Math.floor(total * 0.15);
  const hasPadding = minimumX >= paddingX && minimumY >= paddingY &&
    maximumX < width - paddingX && maximumY < height - paddingY;
  return {
    width,
    height,
    occupied,
    occupiedRatio: occupied / total,
    transparent,
    transparentRatio: transparent / total,
    bounds: [minimumX, minimumY, maximumX, maximumY],
    padding: [paddingX, paddingY],
    valid: occupied >= minimumOccupied && transparent >= minimumTransparent && hasPadding,
    reasons: [
      ...(occupied < minimumOccupied ? [`主体占比不足 3%（${occupied}/${total}）`] : []),
      ...(transparent < minimumTransparent ? [`透明像素不足 15%（${transparent}/${total}）`] : []),
      ...(!hasPadding ? [`主体四周未保留至少 3% 透明留白（边界 ${minimumX},${minimumY},${maximumX},${maximumY}）`] : []),
    ],
  };
}

function validateAsset(inputPath) {
  const filePath = path.resolve(inputPath);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('必须是普通文件，不能是目录或符号链接');
  if (stat.size < 1 || stat.size > MAX_BYTES) throw new Error('文件必须大于 0 且不超过 2 MB');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-composer-mascot-'));
  try {
    const output = execFileSync('/usr/bin/sips', [
      '-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', filePath,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const format = output.match(/format:\s*(\S+)/u)?.[1]?.toLowerCase();
    const width = Number(output.match(/pixelWidth:\s*(\d+)/u)?.[1]);
    const height = Number(output.match(/pixelHeight:\s*(\d+)/u)?.[1]);
    const hasAlpha = /hasAlpha:\s*(?:yes|true|1)/iu.test(output);
    if (!['png', 'webp'].includes(format)) throw new Error('只接受 PNG 或 WebP');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('无法读取有效图像尺寸');
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      throw new Error('尺寸超过 2048 px 或 400 万像素安全上限');
    }
    const ratio = width / height;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) throw new Error(`宽高比 ${ratio.toFixed(3)} 不在 0.8–1.25`);
    if (!hasAlpha) throw new Error('缺少真实透明通道');

    const alpha = inspectAlphaBitmap(filePath, directory);
    if (!alpha.valid) throw new Error(alpha.reasons.join('；'));
    return {filePath, bytes: stat.size, format, width, height, ratio, alpha};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

const inputs = process.argv.slice(2);
if (inputs.length === 0 || inputs.includes('--help') || inputs.includes('-h')) {
  console.log('用法：node scripts/validate-composer-mascot.mjs <PNG/WebP> [更多素材...]');
  console.log('校验真实透明通道、0.8–1.25 宽高比、主体占比、透明像素和四周透明留白。');
  process.exitCode = inputs.length === 0 ? 2 : 0;
} else {
  let failures = 0;
  for (const input of inputs) {
    try {
      const result = validateAsset(input);
      console.log(`PASS ${result.filePath} | ${result.width}x${result.height} ${result.format.toUpperCase()} | ` +
        `透明 ${(result.alpha.transparentRatio * 100).toFixed(1)}% | 主体 ${(result.alpha.occupiedRatio * 100).toFixed(1)}%`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${path.resolve(input)} | ${error.message}`);
    }
  }
  if (failures > 0) {
    console.error(`校验失败：${failures}/${inputs.length} 个素材不符合 WorkBuddy 悬浮主体标准。`);
    process.exitCode = 1;
  } else {
    console.log(`全部通过：${inputs.length}/${inputs.length} 个素材符合 WorkBuddy 悬浮主体标准。`);
  }
}
