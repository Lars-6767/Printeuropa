import { DEFAULTS, type ConfigKey, type ConfigMap } from "./config";
import { one, q, tx, type Db } from "./db";
import { audit } from "./audit";

export interface ConfigVersion<K extends ConfigKey = ConfigKey> {
  id: number;
  key: K;
  version: number;
  status: "draft" | "published" | "archived";
  data: ConfigMap[K];
  effective_from: string | null;
  note: string | null;
  created_by: number | null;
  created_at: Date;
  published_at: Date | null;
}

/** De gepubliceerde (werkende) configuratie. Valt terug op de startgegevens wanneer nog niets is gepubliceerd. */
export async function getConfig<K extends ConfigKey>(key: K, db?: Db): Promise<ConfigMap[K]> {
  const v = await getPublished(key, db);
  return v ? ({ ...DEFAULTS[key], ...v.data } as ConfigMap[K]) : DEFAULTS[key];
}

export async function getPublished<K extends ConfigKey>(key: K, db?: Db): Promise<ConfigVersion<K> | null> {
  return one<ConfigVersion<K>>(
    `SELECT * FROM config_versions WHERE key=$1 AND status='published' ORDER BY version DESC LIMIT 1`, [key], db,
  );
}

export async function getConfigs<K extends ConfigKey>(keys: K[], db?: Db): Promise<Pick<ConfigMap, K> & { refs: Record<string, number> }> {
  const rows = await q<ConfigVersion>(
    `SELECT DISTINCT ON (key) * FROM config_versions WHERE key = ANY($1) AND status='published' ORDER BY key, version DESC`, [keys], db,
  );
  const out: any = { refs: {} };
  for (const k of keys) {
    const r = rows.find((x) => x.key === k);
    out[k] = r ? { ...DEFAULTS[k], ...(r.data as any) } : DEFAULTS[k];
    out.refs[k] = r?.version ?? 0;
  }
  return out;
}

export async function getDraft<K extends ConfigKey>(key: K, db?: Db): Promise<ConfigVersion<K> | null> {
  return one<ConfigVersion<K>>(`SELECT * FROM config_versions WHERE key=$1 AND status='draft'`, [key], db);
}

export async function history(key: ConfigKey) {
  return q<ConfigVersion>(`SELECT cv.*, u.name AS author FROM config_versions cv LEFT JOIN users u ON u.id = cv.created_by WHERE key=$1 ORDER BY version DESC LIMIT 50`, [key]);
}

export async function saveDraft<K extends ConfigKey>(key: K, data: ConfigMap[K], userId: number, note?: string) {
  return tx(async (c) => {
    const draft = await getDraft(key, c);
    if (draft) {
      await c.query(`UPDATE config_versions SET data=$1, note=$2, created_by=$3, created_at=now() WHERE id=$4`, [data, note ?? draft.note, userId, draft.id]);
    } else {
      const max = await one<{ v: number }>(`SELECT COALESCE(MAX(version),0) AS v FROM config_versions WHERE key=$1`, [key], c);
      await c.query(`INSERT INTO config_versions(key, version, status, data, note, created_by) VALUES ($1,$2,'draft',$3,$4,$5)`, [key, max!.v + 1, data, note ?? null, userId]);
    }
    await audit(c, { actor: userId, action: "config.draft_saved", entityType: "config", data: { key } });
  });
}

export async function discardDraft(key: ConfigKey, userId: number) {
  await tx(async (c) => {
    await c.query(`DELETE FROM config_versions WHERE key=$1 AND status='draft'`, [key]);
    await audit(c, { actor: userId, action: "config.draft_discarded", entityType: "config", data: { key } });
  });
}

/** Controle vóór publicatie. Geeft begrijpelijke foutmeldingen terug. */
export function validateForPublish<K extends ConfigKey>(key: K, data: ConfigMap[K]): string[] {
  const errs: string[] = [];
  const d: any = data;
  if (key === "pricing") {
    if (!(d.vatBp >= 0 && d.vatBp <= 10000)) errs.push("Btw-percentage is ongeldig.");
    for (const b of d.boxes) {
      if (!(b.monthlyCents >= 0)) errs.push(`Maandprijs ${b.label} ontbreekt.`);
      if (!(b.emptyingCents > 0)) errs.push(`Legingsprijs ${b.label} ontbreekt.`);
      if (!(b.capacityKg > 0)) errs.push(`Adviescapaciteit ${b.label} ontbreekt.`);
    }
  }
  if (key === "transport") {
    if (!(d.centsPerKm > 0)) errs.push("Kilometertarief moet groter dan nul zijn.");
    if (!d.depotAddress) errs.push("Depotadres ontbreekt.");
    for (const r of d.regionOverrides) if (r.fromPostcode > r.toPostcode) errs.push(`Regio ${r.fromPostcode}–${r.toPostcode}: van is groter dan tot.`);
  }
  if (key === "packages") {
    const sched = d.items.find((p: any) => p.kind === "scheduled" && p.active);
    if (sched && !d.discountOrderConfirmed) {
      errs.push("Bevestig de kortingsvolgorde van 'Bereyl geregeld' (nu " + sched.frequencies.map((f: any) => `${f.perYear}×: ${f.discountBp / 100}%`).join(", ") + ") vóór publicatie.");
    }
    if (!d.items.some((p: any) => p.active)) errs.push("Minimaal één pakket moet actief zijn.");
    const codes = new Set<string>();
    for (const p of d.items) {
      if (codes.has(p.code)) errs.push(`Pakketcode ${p.code} komt dubbel voor.`);
      codes.add(p.code);
      if (p.kind === "scheduled" && p.active && p.frequencies.length === 0) errs.push(`${p.name}: voeg minimaal één frequentie toe.`);
    }
  }
  if (key === "printmasters") {
    for (const r of d.rules.filter((r: any) => r.active)) {
      if (r.kind === "clothing_minimum" && Object.values(r.minimumPiecesPerYear).some((v) => v === null)) errs.push(`${r.name}: vul de kledingminima per boxformaat in.`);
      if (r.kind === "other_products" && r.minimumAnnualSpendCents === null) errs.push(`${r.name}: de voordeelregel voor andere producten is nog niet vastgesteld.`);
    }
  }
  if (key === "planning") {
    if (d.postcodeRanges.length === 0) errs.push("Het werkgebied heeft geen postcodes.");
    if (d.dayparts.length === 0) errs.push("Voeg minimaal één dagdeel toe.");
  }
  if (key === "contract") {
    if (!(d.proposalValidityDays > 0)) errs.push("Geldigheid van het voorstel ontbreekt.");
    if (!d.termsVersion) errs.push("Voorwaardenversie ontbreekt.");
  }
  if (key === "impact") {
    for (const m of d.methods.filter((m: any) => m.active)) {
      if (m.factorPerKg === null || !m.source || !m.method || !m.version) errs.push(`${m.label}: een actieve methode vereist factor, bron, methode en versie.`);
    }
  }
  return errs;
}

export async function publishDraft(key: ConfigKey, userId: number, effectiveFrom: string | null) {
  return tx(async (c) => {
    const draft = await getDraft(key, c);
    if (!draft) throw new Error("Er is geen concept om te publiceren.");
    const errs = validateForPublish(key, draft.data);
    if (errs.length) return { ok: false as const, errors: errs };
    await c.query(`UPDATE config_versions SET status='archived' WHERE key=$1 AND status='published'`, [key]);
    await c.query(`UPDATE config_versions SET status='published', published_at=now(), effective_from=$2 WHERE id=$1`, [draft.id, effectiveFrom]);
    await audit(c, { actor: userId, action: "config.published", entityType: "config", entityId: draft.id, data: { key, version: draft.version, effectiveFrom } });
    return { ok: true as const, version: draft.version };
  });
}

/** Terugzetten: maakt een nieuw concept met de inhoud van een eerdere versie. */
export async function restoreVersion(key: ConfigKey, version: number, userId: number) {
  const v = await one<ConfigVersion>(`SELECT * FROM config_versions WHERE key=$1 AND version=$2`, [key, version]);
  if (!v) throw new Error("Versie niet gevonden");
  await saveDraft(key, v.data as any, userId, `Teruggezet vanaf versie ${version}`);
}

/** Openstaande activatiepunten: waarden die Bereyl nog moet vaststellen. */
export async function activationIssues(): Promise<{ area: string; message: string; href: string }[]> {
  const cfg = await getConfigs(["pricing", "packages", "printmasters", "contract", "integrations", "impact"]);
  const out: { area: string; message: string; href: string }[] = [];
  const P = "/beheer/instellingen/";
  if (cfg.pricing.placementCents === null) out.push({ area: "Tarieven", message: "Tarief voor plaatsing is nog niet vastgesteld.", href: P + "pricing" });
  if (cfg.pricing.swapCents === null) out.push({ area: "Tarieven", message: "Tarief voor omruilen is nog niet vastgesteld.", href: P + "pricing" });
  if (cfg.pricing.finalPickupCents === null) out.push({ area: "Tarieven", message: "Tarief voor definitief ophalen is nog niet vastgesteld.", href: P + "pricing" });
  if (!cfg.packages.discountOrderConfirmed) out.push({ area: "Abonnementen", message: "Kortingsvolgorde 30% / 25% / 30% voor Bereyl geregeld is nog niet bevestigd.", href: P + "packages" });
  const other = cfg.printmasters.rules.find((r) => r.kind === "other_products");
  if (other && other.minimumAnnualSpendCents === null) out.push({ area: "PrintMasters", message: "Voordeelregel voor afname van andere PrintMasters-producten is nog niet vastgesteld.", href: P + "printmasters" });
  if (cfg.contract.startRule === null) out.push({ area: "Contract", message: "Startmoment van het abonnement is nog niet ingesteld (nu: plaatsingsdatum als voorlopige regel).", href: P + "contract" });
  if (cfg.contract.billingStopRule === null) out.push({ area: "Contract", message: "Moment waarop de abonnementsbetaling stopt bij opzeggen is nog niet ingesteld (nu: einddatum als voorlopige regel).", href: P + "contract" });
  if (cfg.contract.creditOnPackageChange === null) out.push({ area: "Contract", message: "Tegoedafhandeling bij pakketwissel is nog niet ingesteld (nu: tegoed loopt door tot einde periode).", href: P + "contract" });
  if (cfg.contract.termsVersion.startsWith("concept")) out.push({ area: "Contract", message: "Definitieve boxvoorwaarden zijn nog niet vastgesteld.", href: P + "contract" });
  if (cfg.integrations.paymentProvider === "none") out.push({ area: "Koppelingen", message: "Betaalprovider en incassoroute zijn nog niet gekozen.", href: P + "integrations" });
  if (cfg.integrations.accountingProvider === "none") out.push({ area: "Koppelingen", message: "Boekhoudpakket is nog niet gekozen.", href: P + "integrations" });
  if (!cfg.integrations.invoiceSender.iban || !cfg.integrations.invoiceSender.coc || !cfg.integrations.invoiceSender.vat) out.push({ area: "Koppelingen", message: "Factuurgegevens (KvK, btw-nummer, IBAN) zijn onvolledig.", href: P + "integrations" });
  if (cfg.integrations.internalRecipients.length === 0) out.push({ area: "Koppelingen", message: "Interne e-mailontvangers zijn nog niet ingesteld.", href: P + "integrations" });
  if (!process.env.SMTP_HOST) out.push({ area: "Koppelingen", message: "Mailserver (SMTP) is niet geconfigureerd: e-mails worden alleen gelogd.", href: "/beheer/koppelingen" });
  if (cfg.integrations.routingProvider !== "openrouteservice" || !process.env.ORS_API_KEY) out.push({ area: "Koppelingen", message: "Routeberekening is niet actief: vervoer is een demo-indicatie of nog vast te stellen.", href: "/beheer/koppelingen" });
  return out;
}
