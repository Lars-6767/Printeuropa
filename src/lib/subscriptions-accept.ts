import { one, q, type Db } from "./db";
import { enqueue } from "./jobs";
import { applyAcceptedChange } from "./subscriptions";
import type { PreferenceInput } from "./appointments";

/** Akkoord op een wijzigingsvoorstel binnen een bestaande transactie (zelfde vastlegging als bij een nieuw voorstel). */
export async function acceptProposalInTx(db: Db, proposalId: number, userId: number, meta: { ip: string | null; userAgent: string | null }, extra?: { prefs?: PreferenceInput }) {
  const p = await one<any>(`SELECT * FROM proposals WHERE id=$1 FOR UPDATE`, [proposalId], db);
  const existing = await one<{ id: number }>(`SELECT id FROM acceptances WHERE proposal_id=$1`, [proposalId], db);
  if (existing) return existing.id;
  const o = p.offer;
  const acc = await one<{ id: number }>(
    `INSERT INTO acceptances(proposal_id, user_id, proposal_version, terms_version, amounts, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [proposalId, userId, p.version, p.terms_version, JSON.stringify({ monthlyCents: o.monthlyCents, singleEmptyingCents: o.singleEmptyingCents, swapCents: o.swapCents ?? null, includedPerYear: o.includedPerYear }), meta.ip, meta.userAgent], db,
  );
  await q(`UPDATE proposals SET status='accepted' WHERE id=$1`, [proposalId], db);
  await enqueue(db, "acceptance.pdf", { acceptanceId: acc!.id }, `acceptance:${acc!.id}:pdf`);
  await applyAcceptedChange(db, p, userId, extra);
  return acc!.id;
}
