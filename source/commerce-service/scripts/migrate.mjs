import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTrustedCommerceConfig} from '../src/config.mjs';
import {createPostgresPoolOptions} from '../src/production-adapters.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

function migrationBody(sql, filename) {
  const match = sql.match(/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u);
  if (!match) throw new Error(`${filename} 必须只包含一个外层 BEGIN/COMMIT`);
  return match[1];
}

const files = fs.readdirSync(MIGRATIONS)
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
  .sort();
if (!files.length || files.some((name, index) => Number(name.slice(0, 3)) !== index + 1)) {
  throw new Error('迁移必须从 001 开始连续编号');
}

const config = loadTrustedCommerceConfig(process.env);
const pg = await import('pg');
const Pool = pg.Pool ?? pg.default?.Pool;
if (typeof Pool !== 'function') throw new Error('pg 没有导出 Pool');
const pool = new Pool({...createPostgresPoolOptions(process.env, config.databaseUrl), max: 1});
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtextextended('lingglow-commerce-migrations', 0))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS commerce_schema_migrations (
      version integer PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
  for (const filename of files) {
    const version = Number(filename.slice(0, 3));
    const sql = fs.readFileSync(path.join(MIGRATIONS, filename), 'utf8');
    const sha256 = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
    const existing = await client.query(
      'SELECT filename, sha256 FROM commerce_schema_migrations WHERE version = $1', [version],
    );
    if (existing.rowCount === 1) {
      if (existing.rows[0].filename !== filename || existing.rows[0].sha256 !== sha256) {
        throw new Error(`已应用迁移 ${version} 发生漂移，拒绝继续`);
      }
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(migrationBody(sql, filename));
      await client.query(`
        INSERT INTO commerce_schema_migrations (version, filename, sha256)
        VALUES ($1,$2,$3)
      `, [version, filename, sha256]);
      await client.query('COMMIT');
      process.stdout.write(`${JSON.stringify({event: 'migration_applied', version, filename})}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try { await client.query("SELECT pg_advisory_unlock(hashtextextended('lingglow-commerce-migrations', 0))"); }
  finally { client.release(); await pool.end(); }
}

export const migrationInternals = Object.freeze({migrationBody});
