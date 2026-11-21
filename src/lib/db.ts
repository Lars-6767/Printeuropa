import pg from "pg";

// Bigint (count/sum) als number teruggeven; bedragen blijven ruim binnen veilige integers.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// 'date'-kolommen als ISO-string (YYYY-MM-DD) zodat er geen tijdzoneverschuiving optreedt.
pg.types.setTypeParser(1082, (v) => v);

const globalForPool = globalThis as unknown as { __bereylPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.__bereylPool) {
    globalForPool.__bereylPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return globalForPool.__bereylPool;
}

export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  const res = await db.query(sql, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Voert fn uit in één transactie. Zakelijke mutaties en hun automatiseringsjobs worden zo samen opgeslagen. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Volgend nummer uit een teller, bijv. nextNumber(c, 'request-2026') → 1 */
export async function nextNumber(db: Db, name: string): Promise<number> {
  const row = await one<{ value: number }>(
    `INSERT INTO counters(name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [name],
    db,
  );
  return row!.value;
}

export function pad(n: number, len = 4) {
  return String(n).padStart(len, "0");
}
