#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const entries = [
  ["icp4", "icon_16x16.png", 16],
  ["icp5", "icon_32x32.png", 32],
  ["ic11", "icon_16x16@2x.png", 32],
  ["ic12", "icon_32x32@2x.png", 64],
  ["ic07", "icon_128x128.png", 128],
  ["ic13", "icon_128x128@2x.png", 256],
  ["ic08", "icon_256x256.png", 256],
  ["ic14", "icon_256x256@2x.png", 512],
  ["ic09", "icon_512x512.png", 512],
  ["ic10", "icon_512x512@2x.png", 1024],
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [iconsetArg, outputArg] = process.argv.slice(2);
if (!iconsetArg || !outputArg) {
  fail("用法：write_icns.mjs <AppIcon.iconset> <output.icns>");
}

const iconset = path.resolve(iconsetArg);
const output = path.resolve(outputArg);
const iconsetStat = fs.lstatSync(iconset, { throwIfNoEntry: false });
if (!iconsetStat?.isDirectory() || iconsetStat.isSymbolicLink()) {
  fail(`拒绝读取非普通 iconset 目录：${iconset}`);
}
if (fs.lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) {
  fail(`拒绝覆盖符号链接：${output}`);
}

const chunks = entries.map(([type, filename, expectedSize]) => {
  const file = path.join(iconset, filename);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`拒绝读取不安全的图标切片：${file}`);
  }

  const png = fs.readFileSync(file);
  if (
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.toString("ascii", 12, 16) !== "IHDR"
  ) {
    fail(`图标切片不是有效 PNG：${file}`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    fail(`图标切片尺寸错误：${filename} 应为 ${expectedSize}×${expectedSize}`);
  }

  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(png.length + header.length, 4);
  return Buffer.concat([header, png]);
});

const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
if (totalLength > 0xffff_ffff) {
  fail("ICNS 文件超过 4 GiB 格式上限");
}
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(totalLength, 4);

fs.writeFileSync(output, Buffer.concat([header, ...chunks]), {
  mode: 0o644,
  flag: "wx",
});
