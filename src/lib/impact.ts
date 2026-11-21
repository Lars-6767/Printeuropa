/** Impact: één bron (view confirmed_weights) voor publieke meter, klantdashboard en beheer. */
import { one, q, type Db } from "./db";
import { getConfig } from "./settings";
import { emitEvent, enqueue } from "./jobs";
import { audit } from "./audit";
import { nextNumber, pad } from "./db";
import { today } from "./dates";

export async function publicTotal(db?: Db) {
  const demo = process.env.DEMO_MODE === "true";
  const r = await one<{ grams: number; n: number; demo_grams: number }>(
    `SELECT COALESCE(SUM(net_weight_grams) FILTER (WHERE NOT is_demo),0) AS grams,
            COUNT(*) FILTER (WHERE NOT is_demo) AS n,
            COALESCE(SUM(net_weight_grams) FILTER (WHERE is_demo),0) AS demo_grams
     FROM confirmed_weights`, [], db,
  );
  return { grams: r!.grams + (demo ? r!.demo_grams : 0), collections: r!.n, includesDemo: demo && r!.demo_grams > 0 };
}

export async function companyImpact(companyId: number, f: { from?: string; to?: string; locationId?: number | null } = {}, db?: Db) {
  const params: unknown[] = [companyId, f.from ?? null, f.to ?? null, f.locationId ?? null];
  const where = `company_id=$1 AND ($2::date IS NULL OR collected_at >= $2::date) AND ($3::date IS NULL OR collected_at < ($3::date + 1)) AND ($4::int IS NULL OR location_id=$4)`;
  const totals = await one<{ grams: number; n: number }>(`SELECT COALESCE(SUM(net_weight_grams),0) AS grams, COUNT(*) AS n FROM confirmed_weights WHERE ${where}`, params, db);
  const executed = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments WHERE company_id=$1 AND type IN ('emptying','swap','final_pickup') AND execution_status='executed'
     AND ($2::date IS NULL OR executed_at >= $2::date) AND ($3::date IS NULL OR executed_at < ($3::date + 1)) AND ($4::int IS NULL OR location_id=$4)`, params, db,
  );
  const history = await q<any>(
    `SELECT c.id, c.collected_at, c.status, c.net_weight_grams, l.name AS location_name, a.number, b.destination, b.status AS batch_status, b.number AS batch_number,
       (SELECT json_agg(cp.file_id) FROM collection_photos cp WHERE cp.collection_id=c.id) AS photos,
       (SELECT COUNT(*) FROM weight_corrections w WHERE w.collection_id=c.id) AS corrections
     FROM collections c JOIN locations l ON l.id=c.location_id JOIN appointments a ON a.id=c.appointment_id LEFT JOIN processing_batches b ON b.id=c.batch_id
     WHERE c.company_id=$1 AND ($2::date IS NULL OR c.collected_at >= $2::date) AND ($3::date IS NULL OR c.collected_at < ($3::date + 1)) AND ($4::int IS NULL OR c.location_id=$4)
     ORDER BY c.collected_at DESC`, params, db,
  );
  const byDestination = await q<{ destination: string; grams: number }>(
    `SELECT b.destination, SUM(cw.net_weight_grams) AS grams FROM confirmed_weights cw JOIN processing_batches b ON b.id=cw.batch_id
     WHERE cw.company_id=$1 AND ($2::date IS NULL OR cw.collected_at >= $2::date) AND ($3::date IS NULL OR cw.collected_at < ($3::date + 1)) AND ($4::int IS NULL OR cw.location_id=$4) AND b.status='processed' AND b.destination IS NOT NULL GROUP BY b.destination`, params, db,
  );
  const impactCfg = await getConfig("impact", db);
  const indicators = impactCfg.methods.filter((m) => m.active && m.factorPerKg !== null).map((m) => ({
    ...m, value: Math.round(((totals!.grams / 1000) * (m.factorPerKg as number)) * 10) / 10,
  }));
  return { grams: totals!.grams, weighedCollections: totals!.n, executedEmptyings: executed!.n, history, byDestination, indicators };
}

export async function createBatch(db: Db, processor: string, staffId: number) {
  const year = today().slice(0, 4);
  const number = `P-${year}-${pad(await nextNumber(db, `batch-${year}`), 3)}`;
  const r = await one<{ id: number }>(`INSERT INTO processing_batches(number, processor) VALUES ($1,$2) RETURNING id`, [number, processor], db);
  await audit(db, { actor: staffId, action: "batch.created", entityType: "batch", entityId: r!.id, data: { number, processor } });
  return r!.id;
}

/**
 * Vrijgave van één certificaat aan meerdere geselecteerde klanten. Iedere klant ziet alleen zijn eigen vrijgave.
 * Optioneel wordt per klant een klantspecifieke verklaring gemaakt.
 */
export async function releaseCertificate(db: Db, certificateId: number, companyIds: number[], withStatements: boolean, staffId: number) {
  const cert = await one<any>(`SELECT * FROM certificates WHERE id=$1 FOR UPDATE`, [certificateId], db);
  if (!cert) return { error: "Certificaat niet gevonden" };
  if (!cert.file_id) return { error: "Upload eerst het certificaat (PDF)." };
  if (companyIds.length === 0) return { error: "Kies minimaal één klant." };
  for (const cid of companyIds) {
    const r = await one<{ id: number }>(
      `INSERT INTO certificate_releases(certificate_id, company_id, released_by) VALUES ($1,$2,$3) ON CONFLICT (certificate_id, company_id) DO NOTHING RETURNING id`,
      [certificateId, cid, staffId], db,
    );
    if (r) {
      if (withStatements && cert.batch_id) await enqueue(db, "statement.pdf", { releaseId: r.id }, `release:${r.id}:statement`);
      await emitEvent(db, "certificate.released", { certificateId, releaseId: r.id, companyId: cid }, `${certificateId}:${cid}`);
    }
  }
  await q(`UPDATE certificates SET status='released' WHERE id=$1`, [certificateId], db);
  await audit(db, { actor: staffId, action: "certificate.released", entityType: "certificate", entityId: certificateId, data: { companyIds, withStatements } });
  return { ok: true };
}
