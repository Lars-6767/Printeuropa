import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { CONFIG_LABELS, DEFAULTS, EVENTS, type ConfigKey, type ConfigMap } from "@/lib/config";
import { CONFIG_SCHEMA } from "@/lib/config-schema";
import { getDraft, getPublished, history, validateForPublish, getConfigs } from "@/lib/settings";
import { computeOffer } from "@/lib/pricing";
import { q } from "@/lib/db";
import { formatEuro } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { ConfigEditor } from "@/components/ConfigEditor";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { discardConfig, publishConfig, restoreConfig, saveConfigDraft } from "../../actions";

const SAMPLE = [{ label: "Breda (5 km)", km: 5, postcode: "4811" }, { label: "Tilburg (27 km)", km: 27, postcode: "5038" }, { label: "Eindhoven (62 km)", km: 62, postcode: "5611" }];

export default async function ConfigPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  await requireStaff(["admin"]);
  if (!(raw in DEFAULTS)) notFound();
  const key = raw as ConfigKey;
  const [published, draft, hist] = await Promise.all([getPublished(key), getDraft(key), history(key)]);
  const current = { ...DEFAULTS[key], ...(published?.data ?? {}) } as any;
  const editing = draft ? { ...DEFAULTS[key], ...(draft.data as any) } : current;
  const problems = draft ? validateForPublish(key, draft.data as any) : [];
  const save = saveConfigDraft.bind(null, key);
  const eventLabels = Object.fromEntries(EVENTS.map((e) => [e.code, e.label]));

  // Voorbeeldberekening: gepubliceerd vs concept, drie formaten en voorbeeldlocaties
  let preview: React.ReactNode = null;
  if (draft && (key === "pricing" || key === "transport" || key === "packages")) {
    const base = await getConfigs(["pricing", "transport", "packages", "printmasters"]);
    const next = { ...base, [key]: editing } as typeof base;
    const rows: React.ReactNode[] = [];
    for (const box of [250, 500, 1000] as const) for (const s of SAMPLE) for (const [pkg, f] of [["on_demand", null], ["scheduled", 4]] as const) {
      const inp = { boxSize: box, packageCode: pkg, frequencyPerYear: f, postcode: s.postcode, distance: { km: s.km, source: "handmatig" as const }, printmasters: { status: "none" as const, ruleCode: null } };
      let a, b;
      try { a = computeOffer(base, inp); b = computeOffer(next, inp); } catch { continue; }
      const changed = a.monthlyCents !== b.monthlyCents || a.singleEmptyingCents !== b.singleEmptyingCents;
      rows.push(<tr key={`${box}${s.km}${pkg}`} style={changed ? { background: "var(--warn-bg)" } : undefined}><td>{box} L</td><td>{s.label}</td><td>{a.packageName}{f ? ` ${f}×` : ""}</td><td>{formatEuro(a.monthlyCents)} → <strong>{formatEuro(b.monthlyCents)}</strong></td><td>{formatEuro(a.singleEmptyingCents)} → <strong>{formatEuro(b.singleEmptyingCents)}</strong></td></tr>);
    }
    const open = await q<any>(`SELECT p.id, p.offer, c.name, l.postcode, l.distance_km, l.distance_source, c.printmasters_status FROM proposals p JOIN companies c ON c.id=p.company_id JOIN locations l ON l.id=p.location_id WHERE p.status='open' AND p.kind='new'`);
    const affected = open.map((p) => {
      try {
        const o = computeOffer(next, { boxSize: p.offer.boxSize, packageCode: p.offer.packageCode, frequencyPerYear: p.offer.frequencyPerYear, postcode: p.postcode, distance: { km: p.distance_km, source: p.distance_source ?? "onbekend" }, printmasters: { status: p.printmasters_status, ruleCode: null } });
        return { name: p.name, from: p.offer.monthlyCents, to: o.monthlyCents };
      } catch { return null; }
    }).filter((x) => x && x.from !== x.to);
    preview = (
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Voorbeeldberekening: gepubliceerd → concept</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Box</th><th>Locatie</th><th>Pakket</th><th>Per maand</th><th>Losse leging</th></tr></thead><tbody>{rows}</tbody></table></div>
        <p className="small"><strong>Nieuwe aanvragen</strong> krijgen na publicatie deze prijzen. Geaccepteerde afspraken en uitgevoerde ritten behouden hun vastgelegde prijs.</p>
        <p className="small"><strong>Openstaande voorstellen met een andere prijs bij een nieuwe versie:</strong> {affected.length ? affected.map((a: any) => `${a.name} (${formatEuro(a.from)} → ${formatEuro(a.to)})`).join(", ") : "geen"}. Deze houden hun huidige prijs tot je een nieuwe versie uitbrengt.</p>
        <p className="small">Bestaande klanten wijzig je apart via <a href="/beheer/prijswijziging">Prijswijziging bestaande klanten</a>.</p>
      </section>
    );
  }

  return (
    <div className="stack-lg">
      <PageHead title={CONFIG_LABELS[key].title} back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro={CONFIG_LABELS[key].intro}
        actions={<span>Gepubliceerd: versie {published?.version ?? "–"} {draft && <Pill tone="warn">Concept versie {draft.version}</Pill>}</span>} />
      {key === "contract" && <p className="notice">Wijzigingen in facturatie- of contractregels gelden voor nieuwe aanbiedingen en wijzigingen. Lopende geaccepteerde afspraken blijven ongewijzigd tot een nieuwe, bevestigde wijziging.</p>}
      <ConfigEditor schema={CONFIG_SCHEMA[key]} initial={editing} save={save} labels={key === "automations" ? eventLabels : undefined} />
      {preview}
      {draft && (
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Publiceren</h2>
          {problems.length > 0 ? <div className="notice notice-warn"><strong>Nog niet publiceerbaar:</strong><ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div> : <p className="small">Het concept is gecontroleerd en klaar om te publiceren.</p>}
          <ActionForm action={publishConfig} className="row">
            <input type="hidden" name="key" value={key} />
            <div style={{ flex: "0 1 220px" }}><Field name="effectiveFrom" label="Ingangsdatum (informatief)" type="date" /></div>
            <Submit className="btn">Publiceer concept</Submit>
          </ActionForm>
          <ActionForm action={discardConfig} confirm="Concept verwijderen?"><input type="hidden" name="key" value={key} /><Submit className="btn btn-ghost btn-sm">Concept verwijderen</Submit></ActionForm>
        </section>
      )}
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Versiegeschiedenis</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Versie</th><th>Status</th><th>Auteur</th><th>Datum</th><th>Toelichting</th><th /></tr></thead>
          <tbody>{hist.map((h: any) => <tr key={h.id}><td>{h.version}</td><td>{h.status === "published" ? <Pill tone="ok">Gepubliceerd</Pill> : h.status === "draft" ? <Pill tone="warn">Concept</Pill> : "Gearchiveerd"}</td><td>{h.author ?? "Systeem"}</td><td>{formatDateTime(h.published_at ?? h.created_at)}</td><td>{h.note}</td>
            <td>{h.status === "archived" && <ActionForm action={restoreConfig}><input type="hidden" name="key" value={key} /><input type="hidden" name="version" value={h.version} /><Submit className="btn btn-ghost btn-sm">Terugzetten</Submit></ActionForm>}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
