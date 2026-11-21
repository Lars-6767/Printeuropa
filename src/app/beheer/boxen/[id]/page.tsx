import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireStaff, appUrl } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { BOX_STATUS, TYPE } from "@/lib/labels";
import { formatDateTime } from "@/lib/dates";
import { formatKg } from "@/lib/money";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, KV } from "@/components/ui";
import { updateBox } from "../../actions";

export default async function BoxDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff();
  const b = await one<any>(`SELECT b.*, c.name AS company_name, l.name AS location_name, l.street, l.city FROM boxes b LEFT JOIN companies c ON c.id=b.company_id LEFT JOIN locations l ON l.id=b.location_id WHERE b.id=$1`, [Number(id)]);
  if (!b) notFound();
  const history = await q<any>(`SELECT c.*, a.number, a.type, co.name AS company_name, CASE WHEN c.box_taken_id=$1 THEN 'meegenomen' ELSE 'geplaatst' END AS role
    FROM collections c JOIN appointments a ON a.id=c.appointment_id JOIN companies co ON co.id=c.company_id WHERE c.box_taken_id=$1 OR c.box_placed_id=$1 ORDER BY c.collected_at DESC`, [b.id]);
  const url = appUrl(`/b/${b.qr_token}`);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#283106", light: "#F8F7F2" } });
  return (
    <div className="stack-lg">
      <PageHead title={`Box ${b.number}`} back={{ href: "/beheer/boxen", label: "Boxen" }} />
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <KV rows={[["Formaat", `${b.size} liter`], ["Status", BOX_STATUS[b.status]], ["Klant", b.company_name ? <Link href={`/beheer/klanten/${b.company_id}`}>{b.company_name}</Link> : "–"], ["Locatie", b.location_name ? `${b.location_name}, ${b.street}, ${b.city}` : "–"], ["Notitie", b.note ?? "–"]]} />
          {b.status !== "placed" && (
            <ActionForm action={updateBox} className="stack">
              <input type="hidden" name="boxId" value={b.id} />
              <Field name="status" label="Status" type="select" defaultValue={b.status} options={["in_stock", "reserved", "in_transit", "maintenance", "retired"].map((s) => ({ value: s, label: BOX_STATUS[s] }))} />
              <Field name="note" label="Notitie" defaultValue={b.note} />
              <Submit className="btn btn-sm btn-secondary">Opslaan</Submit>
            </ActionForm>
          )}
        </div>
        <div className="card stack center">
          <div style={{ maxWidth: 220, margin: "0 auto" }} dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR-code voor box ${b.number}`} />
          <p className="tiny muted" style={{ wordBreak: "break-all" }}>{url}</p>
          <p className="small">De QR-code opent dit dossier alleen voor ingelogde medewerkers.</p>
        </div>
      </div>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Historie</h2>
        <ul className="small">{history.map((h) => <li key={h.id}>{formatDateTime(h.collected_at)} · {TYPE[h.type]} {h.number} · {h.company_name} · {h.role}{h.net_weight_grams ? ` · ${formatKg(h.net_weight_grams)}` : ""}</li>)}</ul>
      </section>
    </div>
  );
}
