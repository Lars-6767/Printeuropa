import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatEuro } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/labels";
import { activeProvider } from "@/lib/payments";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { retryCollect, runBillingAction, simulatePayment } from "../actions";

export default async function Facturen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff(["admin"]);
  const status = sp.status ?? null;
  const list = await q<any>(`SELECT i.*, c.name AS company_name, (SELECT status FROM payments p WHERE p.invoice_id=i.id ORDER BY id DESC LIMIT 1) AS pay_status,
      (SELECT status FROM mandates m WHERE m.company_id=i.company_id ORDER BY id DESC LIMIT 1) AS mandate
    FROM invoices i JOIN companies c ON c.id=i.company_id WHERE ($1::text IS NULL OR i.status=$1) ORDER BY i.id DESC LIMIT 200`, [status]);
  const provider = await activeProvider();
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="stack-lg">
      <PageHead title="Facturen" intro={`Betaalprovider: ${provider.message}. Abonnementen worden achteraf per kalendermaand gefactureerd; ritten direct na uitvoering.`} actions={<ActionForm action={runBillingAction}><Submit className="btn btn-sm btn-secondary">Maandfacturatie nu uitvoeren</Submit></ActionForm>} />
      <nav className="row small" aria-label="Filter">{[["", "Alle"], ...Object.entries(INVOICE_STATUS)].map(([k, l]) => <Link key={k} href={k ? `/beheer/facturen?status=${k}` : "/beheer/facturen"} aria-current={(status ?? "") === k ? "page" : undefined}>{l}</Link>)}</nav>
      <div className="table-wrap card" style={{ padding: 8 }}><table className="table small">
        <thead><tr><th>Nr</th><th>Klant</th><th>Omschrijving</th><th>Totaal</th><th>Status</th><th>Incasso</th><th>Acties</th></tr></thead>
        <tbody>{list.map((i) => (
          <tr key={i.id}>
            <td className="nowrap">{i.pdf_file_id ? <a href={`/api/files/${i.pdf_file_id}`} target="_blank" rel="noopener">{i.number}</a> : i.number ?? "concept"}<div className="tiny muted">{formatDate(i.issued_on, { short: true })}</div></td>
            <td><Link href={`/beheer/klanten/${i.company_id}`}>{i.company_name}</Link></td>
            <td>{i.description}<div className="tiny muted">{i.source_key}</div></td>
            <td>{formatEuro(i.total_cents)}</td>
            <td><Pill tone={i.status === "paid" ? "ok" : i.status === "payment_failed" ? "danger" : undefined}>{INVOICE_STATUS[i.status]}</Pill>{i.send_error && <div className="tiny error-text">{i.send_error}</div>}</td>
            <td>{i.pay_status ?? (i.mandate === "valid" ? "wacht" : <span className="error-text">geen mandaat</span>)}</td>
            <td className="row" style={{ gap: 4 }}>
              {["final", "sent", "payment_failed"].includes(i.status) && i.total_cents > 0 && <ActionForm action={retryCollect}><input type="hidden" name="invoiceId" value={i.id} /><Submit className="btn btn-sm btn-ghost">Incasso opnieuw</Submit></ActionForm>}
              {demo && i.pay_status === "pending" && <>
                <ActionForm action={simulatePayment}><input type="hidden" name="invoiceId" value={i.id} /><input type="hidden" name="status" value="paid" /><Submit className="btn btn-sm btn-secondary">Demo: betaald</Submit></ActionForm>
                <ActionForm action={simulatePayment}><input type="hidden" name="invoiceId" value={i.id} /><input type="hidden" name="status" value="failed" /><Submit className="btn btn-sm btn-ghost">Demo: mislukt</Submit></ActionForm>
              </>}
              {demo && (i.pay_status === "paid" || i.pay_status === "failed") && <ActionForm action={simulatePayment}><input type="hidden" name="invoiceId" value={i.id} /><input type="hidden" name="status" value={i.pay_status} /><Submit className="btn btn-sm btn-ghost">Demo: herhaal bericht</Submit></ActionForm>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
