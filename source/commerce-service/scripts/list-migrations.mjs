import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = fs.readdirSync(root).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name)).sort();
if (!files.length || new Set(files.map((name) => name.slice(0, 3))).size !== files.length) {
  throw new Error('migration 文件为空或序号重复');
}
for (const name of files) {
  const bytes = fs.readFileSync(path.join(root, name));
  process.stdout.write(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
}
