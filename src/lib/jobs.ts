/**
 * Betrouwbare achtergrondverwerking (transactional outbox).
 * Zakelijke mutaties en de bijbehorende job worden in dezelfde transactie opgeslagen.
 * Iedere job heeft een unieke idempotency_key: dubbel aanmaken of opnieuw uitvoeren is veilig.
 */
import { one, q, type Db } from "./db";

export async function enqueue(db: Db, type: string, payload: Record<string, unknown>, key: string, runAt?: Date) {
  await q(
    `INSERT INTO jobs(type, payload, idempotency_key, run_at) VALUES ($1,$2,$3,COALESCE($4, now()))
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [type, payload, key, runAt ?? null], db,
  );
}

/** Zakelijke gebeurtenis; automatiseringen bepalen welke berichten en taken volgen. */
export async function emitEvent(db: Db, event: string, payload: Record<string, unknown>, key: string, runAt?: Date) {
  await enqueue(db, "event", { event, ...payload }, `event:${event}:${key}`, runAt);
}

export interface JobRow { id: number; type: string; payload: any; attempts: number; max_attempts: number; idempotency_key: string }

export async function claimJob(db: Db): Promise<JobRow | null> {
  return one<JobRow>(
    `UPDATE jobs SET status='running', locked_at=now(), attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, type, payload, attempts, max_attempts, idempotency_key`,
    [], db,
  );
}

export async function finishJob(db: Db, id: number, status: "done" | "skipped", result?: unknown) {
  await q(`UPDATE jobs SET status=$2, finished_at=now(), result=$3, last_error=NULL WHERE id=$1`, [id, status, result === undefined ? null : JSON.stringify(result)], db);
}

export async function failJob(db: Db, job: JobRow, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const final = job.attempts >= job.max_attempts;
  const backoffSec = Math.min(3600, 30 * 2 ** (job.attempts - 1));
  await q(
    `UPDATE jobs SET status=$2, last_error=$3, run_at = now() + ($4 || ' seconds')::interval, locked_at=NULL WHERE id=$1`,
    [job.id, final ? "failed" : "queued", msg.slice(0, 2000), String(backoffSec)], db,
  );
}

export async function retryJob(db: Db, id: number) {
  await q(`UPDATE jobs SET status='queued', run_at=now(), attempts=0, max_attempts=5 WHERE id=$1 AND status IN ('failed','skipped')`, [id], db);
}

/** Herstel jobs die bleven hangen (bijv. na een crash van de worker). */
export async function releaseStaleJobs(db: Db) {
  await q(`UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running' AND locked_at < now() - interval '10 minutes'`, [], db);
}
