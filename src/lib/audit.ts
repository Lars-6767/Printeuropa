import type { Db } from "./db";

export async function audit(
  db: Db,
  e: { actor?: number | null; company?: number | null; action: string; entityType?: string; entityId?: number | null; data?: unknown },
) {
  await db.query(
    `INSERT INTO audit_log(actor_user_id, company_id, action, entity_type, entity_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [e.actor ?? null, e.company ?? null, e.action, e.entityType ?? null, e.entityId ?? null, e.data === undefined ? null : JSON.stringify(e.data)],
  );
}
