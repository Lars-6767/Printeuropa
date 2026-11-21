/** Queries voor het klantportaal. Iedere functie filtert op het bedrijf van de ingelogde klant. */
import { one, q } from "./db";
import { creditSummary } from "./credit";

export async function companyOverview(companyId: number) {
  const company = await one<any>(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const locations = await q<any>(`SELECT * FROM locations WHERE company_id=$1 AND active ORDER BY id`, [companyId]);
  const subscriptions = await q<any>(
    `SELECT s.*, l.name AS location_name, l.city, v.terms, v.box_size, v.package_code, v.monthly_cents, v.effective_from AS version_from,
       (SELECT row_to_json(x) FROM (SELECT effective_from, monthly_cents, box_size, package_code, terms->>'packageName' AS package_name FROM subscription_versions WHERE subscription_id=s.id AND status='scheduled') x) AS scheduled
     FROM subscriptions s JOIN locations l ON l.id=s.location_id LEFT JOIN subscription_versions v ON v.subscription_id=s.id AND v.status='active'
     WHERE s.company_id=$1 ORDER BY s.id`, [companyId]);
  for (const s of subscriptions) s.credit = s.started_at ? await creditSummary((await import("./db")).pool(), s.id) : null;
  const openProposals = await q<any>(`SELECT p.*, r.number AS request_number FROM proposals p LEFT JOIN requests r ON r.id=p.request_id WHERE p.company_id=$1 AND p.status='open' ORDER BY p.id DESC`, [companyId]);
  const upcoming = await q<any>(
    `SELECT a.*, l.name AS location_name FROM appointments a JOIN locations l ON l.id=a.location_id
     WHERE a.company_id=$1 AND a.execution_status='pending' AND a.request_status IN ('requested','confirmed') ORDER BY a.planned_date NULLS LAST, a.id`, [companyId]);
  return { company, locations, subscriptions, openProposals, upcoming };
}

export async function appointmentsFor(companyId: number, locationId?: number | null) {
  return q<any>(
    `SELECT a.*, l.name AS location_name, bt.number AS box_taken, bp.number AS box_placed, c.net_weight_grams, c.status AS collection_status
     FROM appointments a JOIN locations l ON l.id=a.location_id LEFT JOIN collections c ON c.appointment_id=a.id
     LEFT JOIN boxes bt ON bt.id=c.box_taken_id LEFT JOIN boxes bp ON bp.id=c.box_placed_id
     WHERE a.company_id=$1 AND ($2::int IS NULL OR a.location_id=$2) ORDER BY COALESCE(a.planned_date, a.created_at::date) DESC, a.id DESC`, [companyId, locationId ?? null]);
}

export async function boxesFor(companyId: number, locationId?: number | null) {
  return q<any>(`SELECT b.*, l.name AS location_name, l.street, l.city FROM boxes b JOIN locations l ON l.id=b.location_id WHERE b.company_id=$1 AND b.status='placed' AND ($2::int IS NULL OR b.location_id=$2) ORDER BY b.number`, [companyId, locationId ?? null]);
}

export async function documentsFor(companyId: number) {
  const proposals = await q<any>(`SELECT p.id, p.version, p.kind, p.status, p.created_at, p.pdf_file_id, r.number FROM proposals p LEFT JOIN requests r ON r.id=p.request_id WHERE p.company_id=$1 ORDER BY p.id DESC`, [companyId]);
  const acceptances = await q<any>(`SELECT a.*, p.kind, r.number, u.name AS user_name FROM acceptances a JOIN proposals p ON p.id=a.proposal_id LEFT JOIN requests r ON r.id=p.request_id JOIN users u ON u.id=a.user_id WHERE p.company_id=$1 ORDER BY a.id DESC`, [companyId]);
  const certificates = await q<any>(`SELECT c.title, c.file_id, cr.released_at, cr.statement_file_id, b.number AS batch_number FROM certificate_releases cr JOIN certificates c ON c.id=cr.certificate_id LEFT JOIN processing_batches b ON b.id=c.batch_id WHERE cr.company_id=$1 ORDER BY cr.released_at DESC`, [companyId]);
  const invoices = await q<any>(`SELECT id, number, pdf_file_id, issued_on, total_cents FROM invoices WHERE company_id=$1 AND number IS NOT NULL ORDER BY id DESC`, [companyId]);
  return { proposals, acceptances, certificates, invoices };
}

export async function invoicesFor(companyId: number) {
  return q<any>(`SELECT i.*, (SELECT status FROM payments WHERE invoice_id=i.id ORDER BY id DESC LIMIT 1) AS payment_status FROM invoices i WHERE company_id=$1 AND status <> 'concept' ORDER BY id DESC`, [companyId]);
}
