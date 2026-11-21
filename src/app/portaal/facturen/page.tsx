import { requireCustomer } from "@/lib/auth";
import { invoicesFor } from "@/lib/portal";
import { one } from "@/lib/db";
import { formatEuro } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/labels";
import { activeProvider } from "@/lib/payments";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHead, Empty, Pill, Flash } from "@/components/ui";
import { payInvoiceAction, startMandateAction } from "../actions";

export default async function Facturen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const [list, mandate, provider] = await Promise.all([
    invoicesFor(ctx.companyId),
    one<any>(`SELECT * FROM mandates WHERE company_id=$1 ORDER BY id DESC LIMIT 1`, [ctx.companyId]),
    activeProvider(),
  ]);
  const tone = (s: string) => (s === "paid" ? "ok" : s === "payment_failed" ? "danger" : s === "credited" ? "muted" : "warn") as any;
  return (
    <div className="stack-lg">
      <PageHead title="Facturen" />
      <Flash searchParams={sp} />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Automatische incasso</h2>
        {mandate?.status === "valid" ? (
          <p style={{ margin: 0 }}><Pill tone="ok">Actief</Pill> Facturen worden automatisch geïncasseerd{mandate.provider === "demo" ? " (demo-provider: er wordt niets echt geïncasseerd)" : ""}.</p>
        ) : mandate?.status === "pending" ? (
          <p style={{ margin: 0 }}><Pill tone="warn">In behandeling</Pill> We verwerken je machtiging.</p>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>Nog geen incassotoestemming. De toestemming wordt vastgelegd bij onze betaalprovider{provider.name ? "" : ` (${provider.message.toLowerCase()})`}.</p>
            {ctx.isAdmin && provider.name && <ActionForm action={startMandateAction}><Submit className="btn btn-secondary btn-sm">Incasso machtigen</Submit></ActionForm>}
          </>
        )}
      </section>
      {list.length === 0 ? <Empty title="Nog geen facturen">Facturen verschijnen hier zodra ze zijn aangemaakt.</Empty> : (
        <div className="table-wrap card" style={{ padding: 8 }}>
          <table className="table">
            <thead><tr><th>Factuur</th><th>Datum</th><th>Omschrijving</th><th>Bedrag</th><th>Status</th><th><span className="sr-only">Acties</span></th></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.id}>
                <td className="nowrap">{i.number}</td>
                <td className="nowrap">{formatDate(i.issued_on, { short: true })}</td>
                <td>{i.description}</td>
                <td className="nowrap">{formatEuro(i.total_cents)}</td>
                <td><Pill tone={tone(i.status)}>{INVOICE_STATUS[i.status]}</Pill>{i.payment_status === "pending" && <span className="tiny muted"> incasso loopt</span>}</td>
                <td className="row" style={{ gap: 6 }}>
                  {i.pdf_file_id && <a className="btn btn-sm btn-secondary" href={`/api/files/${i.pdf_file_id}`} target="_blank" rel="noopener">PDF</a>}
                  {["final", "sent", "payment_failed"].includes(i.status) && i.total_cents > 0 && i.payment_status !== "pending" && (
                    <ActionForm action={payInvoiceAction}><input type="hidden" name="invoiceId" value={i.id} /><Submit className="btn btn-sm">Betaal nu</Submit></ActionForm>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
