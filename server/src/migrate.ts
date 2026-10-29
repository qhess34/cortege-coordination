// Exécuteur de migrations SQL versionnées (fichiers `migrations/NNN_nom.sql`, appliqués dans l'ordre, une fois).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, type Db } from './db.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  return tx(db, async (c) => {
    // Verrou consultatif : deux instances ne migrent pas en même temps.
    await c.query('SELECT pg_advisory_xact_lock(724501)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query(readFileSync(join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      applied.push(f);
    }
    return applied;
  });
}
