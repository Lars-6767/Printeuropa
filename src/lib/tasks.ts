import { one, type Db } from "./db";

export async function createTask(
  db: Db,
  t: { type: string; title: string; detail?: string; companyId?: number | null; refType?: string; refId?: number; priority?: "low" | "normal" | "high"; dueAt?: Date | null; ownerUserId?: number | null; dedupeKey?: string },
) {
  return one<{ id: number }>(
    `INSERT INTO tasks(type, title, detail, company_id, ref_type, ref_id, priority, due_at, owner_user_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [t.type, t.title, t.detail ?? null, t.companyId ?? null, t.refType ?? null, t.refId ?? null, t.priority ?? "normal", t.dueAt ?? new Date(Date.now() + 2 * 86400000), t.ownerUserId ?? null, t.dedupeKey ?? null], db,
  );
}

export async function closeTasks(db: Db, refType: string, refId: number, types?: string[]) {
  await db.query(
    `UPDATE tasks SET status='done', done_at=now() WHERE status='open' AND ref_type=$1 AND ref_id=$2 AND ($3::text[] IS NULL OR type = ANY($3))`,
    [refType, refId, types ?? null],
  );
}
