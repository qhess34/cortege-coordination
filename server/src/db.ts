import pg from 'pg';

export type Db = pg.Pool;
export type Client = pg.PoolClient | pg.Pool;

// Les identifiants bigint sont renvoyés en nombre (ils restent bien en deçà de 2^53).
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Exécute `fn` dans une transaction ; annule en cas d'erreur. */
export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
