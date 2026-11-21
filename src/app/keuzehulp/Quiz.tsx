"use client";
/**
 * Keuzehulp: één hoofdvraag per scherm, grote antwoordkaarten, terugknop en voortgang.
 * De toestand wordt bewaard in sessionStorage (blijft staan bij vernieuwen en teruggaan).
 * Alle prijzen komen van de server (quoteAction); de definitieve berekening gebeurt bij verzenden.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdviceConfig, BoxConfig, PackageConfig, PrintmastersRule } from "@/lib/config";
import type { Offer } from "@/lib/pricing";
import type { Advice } from "@/lib/advice";
import { formatEuro } from "@/lib/money";
import { quoteAction, submitAction } from "./actions";
import { PreferencePicker } from "@/components/PreferencePicker";

type PM = "customer" | "intro" | "no";
interface State {
  submissionId: string;
  step: number;
  printmasters: PM | null;
  pmPieces: string;
  pmProducts: string;
  unit: "kg" | "pieces" | "bags" | "unknown" | null;
  amount: string;
  employees: string;
  replacement: string;
  stock: string;
  boxSize: number | null;
  packageCode: string | null;
  frequency: number | null;
  postcode: string;
  companyName: string; contactName: string; email: string; phone: string; coc: string;
  street: string; city: string; instructions: string; note: string;
  invDifferent: boolean; invAttn: string; invStreet: string; invPostcode: string; invCity: string; invEmail: string;
  flexible: boolean;
  slots: { date: string; daypart: string | null }[];
}

const KEY = "bereyl-keuzehulp-v1";
const STEPS = ["PrintMasters", "Hoeveelheid", "Advies", "Pakket en prijs", "Bedrijf", "Plaatsing", "Voorkeur", "Samenvatting"];

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function initialState(init: { box: number | null; pakket: string | null; postcode: string | null }): State {
  return {
    submissionId: uuid(), step: 0, printmasters: null, pmPieces: "", pmProducts: "",
    unit: null, amount: "", employees: "", replacement: "", stock: "",
    boxSize: init.box, packageCode: init.pakket, frequency: null, postcode: init.postcode ?? "",
    companyName: "", contactName: "", email: "", phone: "", coc: "",
    street: "", city: "", instructions: "", note: "",
    invDifferent: false, invAttn: "", invStreet: "", invPostcode: "", invCity: "", invEmail: "",
    flexible: false, slots: [],
  };
}

export function Quiz(props: {
  initial: { box: number | null; pakket: string | null; postcode: string | null };
  boxes: BoxConfig[];
  packages: PackageConfig[];
  pmRule: PrintmastersRule | null;
  advice: AdviceConfig;
  planning: { dayparts: { code: string; label: string }[]; days: string[]; minLeadDays: number; maxPreferences: number; workAreaName: string };
  vatBp: number;
}) {
  const router = useRouter();
  const [s, setS] = useState<State>(() => initialState(props.initial));
  const [loaded, setLoaded] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [outside, setOutside] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [quoting, startQuote] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Herstel na vernieuwen
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as State;
        setS((cur) => ({ ...saved, boxSize: props.initial.box ?? saved.boxSize, packageCode: props.initial.pakket ?? saved.packageCode, postcode: props.initial.postcode ?? saved.postcode }));
      }
    } catch { /* geen opslag beschikbaar */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [s, loaded]);

  // Terugknop van de browser gaat een stap terug
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const step = typeof e.state?.step === "number" ? e.state.step : 0;
      setS((cur) => ({ ...cur, step }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const go = (step: number) => {
    setErrors({});
    setS((cur) => ({ ...cur, step }));
    window.history.pushState({ step }, "", `?stap=${step + 1}`);
    requestAnimationFrame(() => { headingRef.current?.focus(); window.scrollTo({ top: 0 }); });
  };

  const inflow = useMemo(() => ({
    unit: s.unit ?? "kg",
    amount: s.amount ? Number(s.amount.replace(",", ".")) : null,
    employees: s.employees ? Number(s.employees) : null,
    replacementPerYear: s.replacement ? Number(s.replacement) : null,
    oneOffStockKg: s.stock ? Number(s.stock.replace(",", ".")) : null,
  }), [s.unit, s.amount, s.employees, s.replacement, s.stock]);

  const visiblePackages = props.packages.filter((p) => p.kind !== "printmasters" || s.printmasters === "customer");
  const pkg = visiblePackages.find((p) => p.code === s.packageCode) ?? null;

  // Herbereken bij iedere wijziging van formaat, pakket, frequentie, locatie of PrintMasters-afspraak
  useEffect(() => {
    if (!loaded || s.step < 2 || !s.printmasters) return;
    const pc = s.postcode.replace(/\s/g, "");
    const t = setTimeout(() => {
      startQuote(async () => {
        const r = await quoteAction({
          boxSize: s.boxSize ?? 500,
          packageCode: pkg?.code ?? visiblePackages[0]?.code ?? "on_demand",
          frequencyPerYear: pkg?.kind === "scheduled" ? s.frequency ?? pkg.frequencies[0]?.perYear ?? null : null,
          postcode: /^\d{4}/.test(pc) ? pc : null,
          street: s.step >= 5 ? s.street : undefined,
          city: s.step >= 5 ? s.city : undefined,
          printmasters: s.printmasters!,
          inflow: s.unit ? inflow : undefined,
        });
        if (r.ok) {
          setOffers(r.offers); setAdvice(r.advice); setOutside(r.outside); setQuoteError(null);
          if (s.boxSize === null && r.advice) set("boxSize", r.advice.recommended);
        } else setQuoteError(r.error);
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, s.step, s.boxSize, s.packageCode, s.frequency, s.postcode, s.printmasters, inflow, s.street, s.city]);

  const offer = offers?.find((o) => o.boxSize === s.boxSize) ?? null;

  function payload() {
    return {
      submissionId: s.submissionId,
      printmasters: s.printmasters,
      pmFollowUp: s.printmasters === "customer" ? { piecesPerYear: s.pmPieces ? Number(s.pmPieces) : null, products: s.pmProducts } : undefined,
      inflow,
      boxSize: s.boxSize,
      packageCode: s.packageCode,
      frequencyPerYear: pkg?.kind === "scheduled" ? s.frequency ?? pkg.frequencies[0]?.perYear ?? null : null,
      company: { name: s.companyName, contactName: s.contactName, email: s.email, phone: s.phone, coc: s.coc },
      location: { street: s.street, postcode: s.postcode, city: s.city, instructions: s.instructions, note: s.note },
      invoice: { differentAddress: s.invDifferent, attn: s.invAttn, street: s.invStreet, postcode: s.invPostcode, city: s.invCity, email: s.invEmail },
      preferences: { flexible: s.flexible, slots: s.flexible ? [] : s.slots.filter((x) => x.date) },
    };
  }

  // Validatie per stap (de server valideert opnieuw)
  function validate(step: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (step === 0 && !s.printmasters) e.printmasters = "Kies een antwoord.";
    if (step === 1) {
      if (!s.unit) e.unit = "Kies hoe je de hoeveelheid wilt opgeven.";
      else if (s.unit !== "unknown" && !(Number(s.amount.replace(",", ".")) > 0)) e.amount = "Vul een hoeveelheid in.";
      else if (s.unit === "unknown") {
        if (!(Number(s.employees) > 0)) e.employees = "Vul het aantal medewerkers in.";
        if (!s.replacement) e.replacement = "Kies hoe vaak de kleding wordt vervangen.";
      }
    }
    if (step === 2 && !s.boxSize) e.boxSize = "Kies een boxformaat.";
    if (step === 3) {
      if (!pkg) e.packageCode = "Kies een pakket.";
      if (!/^[1-9]\d{3}\s?[a-zA-Z]{2}$/.test(s.postcode.trim())) e.postcode = "Vul een geldige postcode in (1234 AB).";
    }
    if (step === 4) {
      if (s.companyName.trim().length < 2) e["company.name"] = "Vul de bedrijfsnaam in.";
      if (s.contactName.trim().length < 2) e["company.contactName"] = "Vul de naam van de contactpersoon in.";
      if (!/^\S+@\S+\.\S+$/.test(s.email.trim())) e["company.email"] = "Vul een geldig e-mailadres in.";
      if (s.phone.replace(/\D/g, "").length < 8) e["company.phone"] = "Vul een telefoonnummer in voor afstemming.";
    }
    if (step === 5) {
      if (s.street.trim().length < 3) e["location.street"] = "Vul straat en huisnummer in.";
      if (s.city.trim().length < 2) e["location.city"] = "Vul de plaats in.";
      if (s.invDifferent) {
        if (s.invStreet.trim().length < 3) e["invoice.street"] = "Vul het factuuradres in.";
        if (!/^[1-9]\d{3}\s?[a-zA-Z]{2}$/.test(s.invPostcode.trim())) e["invoice.postcode"] = "Vul een geldige postcode in.";
        if (s.invCity.trim().length < 2) e["invoice.city"] = "Vul de plaats in.";
      }
      if (s.invEmail && !/^\S+@\S+\.\S+$/.test(s.invEmail.trim())) e["invoice.email"] = "Vul een geldig factuurmailadres in.";
    }
    if (step === 6 && !s.flexible && s.slots.filter((x) => x.date).length === 0) e["preferences.slots"] = "Kies minimaal één voorkeursdag of laat ons in overleg plannen.";
    return e;
  }

  function next() {
    const e = validate(s.step);
    if (Object.keys(e).length) {
      setErrors(e);
      const first = document.querySelector(`[data-field="${CSS.escape(Object.keys(e)[0])}"]`) as HTMLElement | null;
      first?.focus();
      return;
    }
    if (s.step === 3 && outside) return;
    let n = s.step + 1;
    if (s.step === 0 && s.printmasters !== "customer" && s.packageCode === "printmasters") set("packageCode", null);
    go(n);
  }

  function submit() {
    setSubmitError(null);
    start(async () => {
      const r = await submitAction(payload());
      if (r.ok) {
        try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
        router.push(`/keuzehulp/verzonden?nr=${encodeURIComponent(r.requestNumber)}`);
      } else if ("outside" in r && r.outside) {
        router.push(`/maatwerk?postcode=${encodeURIComponent(s.postcode)}`);
      } else if ("fieldErrors" in r && r.fieldErrors) {
        setErrors(r.fieldErrors);
        setSubmitError("Controleer de gemarkeerde gegevens.");
      } else {
        setSubmitError(("error" in r && r.error) || "Er ging iets mis.");
      }
    });
  }

  if (!loaded) return <p className="muted">Keuzehulp laden…</p>;

  const pct = Math.round(((s.step + 1) / STEPS.length) * 100);
  const err = (k: string) => errors[k] ? <span className="error" id={`err-${k}`}>{errors[k]}</span> : null;
  const inp = (k: string, label: string, value: string, onChange: (v: string) => void, o: { type?: string; auto?: string; help?: string; optional?: boolean; mode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] } = {}) => (
    <div className="field">
      <label htmlFor={`q-${k}`}>{label}{o.optional && <span className="muted small"> (optioneel)</span>}</label>
      <input id={`q-${k}`} data-field={k} type={o.type ?? "text"} value={value} autoComplete={o.auto} inputMode={o.mode}
        aria-invalid={errors[k] ? true : undefined} aria-describedby={[o.help ? `help-${k}` : "", errors[k] ? `err-${k}` : ""].join(" ").trim() || undefined}
        onChange={(e) => onChange(e.target.value)} />
      {o.help && <span className="help" id={`help-${k}`}>{o.help}</span>}
      {err(k)}
    </div>
  );

  const priceSummary = offer && (
    <div className="card-soft stack" aria-live="polite">
      <div className="row between">
        <div>
          <div className="price-big">{offer.monthlyCents === null ? "Nog vast te stellen" : formatEuro(offer.monthlyCents)}</div>
          <div className="small muted">per maand, exclusief {props.vatBp / 100}% btw{offer.monthlyVatCents !== null && offer.monthlyCents !== null ? ` (${formatEuro(offer.monthlyCents + offer.monthlyVatCents)} inclusief btw)` : ""}</div>
        </div>
        {quoting && <span className="small muted" role="status">Berekenen…</span>}
      </div>
      <dl className="kv small">
        {offer.lines.map((l, i) => <div key={i} style={{ display: "contents" }}><dt>{l.label}</dt><dd>{l.cents === null ? "nog vast te stellen" : formatEuro(l.cents)}{l.note ? <span className="muted" style={{ fontWeight: 400 }}> · {l.note}</span> : null}</dd></div>)}
        {offer.yearTotalCents !== null && <div style={{ display: "contents" }}><dt>Jaarindicatie</dt><dd>{formatEuro(offer.yearTotalCents)}{offer.frequencyPerYear ? ` bij ${offer.frequencyPerYear} legingen per jaar` : ""}{offer.roundingDiffCents ? <span className="muted" style={{ fontWeight: 400 }}> · {formatEuro(Math.abs(offer.roundingDiffCents))} afrondingsverschil t.o.v. exact jaarbedrag</span> : null}</dd></div>}
      </dl>
      {offer.notes.map((n, i) => <p key={i} className="small notice notice-warn" style={{ margin: 0 }}>{n}</p>)}
    </div>
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row between small">
          <span>Stap {s.step + 1} van {STEPS.length} · {STEPS[s.step]}</span>
          {s.step > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.history.length > 1 ? window.history.back() : go(s.step - 1)}>← Terug</button>}
        </div>
        <div className="progress" role="progressbar" aria-label="Voortgang" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      </div>

      {s.step === 0 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>{props.advice.questions.printmasters}</h1>
          <div className="choices" role="radiogroup" aria-label={props.advice.questions.printmasters} data-field="printmasters" tabIndex={-1}>
            {([["customer", "Ja, we zijn klant", "We nemen al producten af bij PrintMasters"], ["intro", "Nog niet, ik wil kennismaken", "We nemen contact met je op"], ["no", "Nee, alleen Bereyl", "Alleen inzamelen"]] as [PM, string, string][]).map(([v, t, sub]) => (
              <label key={v} className="choice">
                <input type="radio" name="printmasters" value={v} checked={s.printmasters === v} onChange={() => set("printmasters", v)} />
                <span className="title">{t}</span><span className="sub">{sub}</span>
              </label>
            ))}
          </div>
          {err("printmasters")}
          {s.printmasters === "customer" && props.pmRule && (
            <div className="card stack">
              <p className="small muted">Alleen nodig voor de voordeelregel &lsquo;{props.pmRule.name}&rsquo;. Bereyl controleert je klantstatus; tot die tijd is het voordeel voorlopig.</p>
              {props.pmRule.kind === "clothing_minimum"
                ? inp("pmPieces", props.pmRule.followUpQuestion, s.pmPieces, (v) => set("pmPieces", v.replace(/\D/g, "")), { mode: "numeric", optional: true, help: "Een schatting is goed." })
                : inp("pmProducts", props.pmRule.followUpQuestion, s.pmProducts, (v) => set("pmProducts", v), { optional: true })}
            </div>
          )}
          {s.printmasters === "intro" && <p className="notice">Leuk! We maken een taak aan zodat een collega van PrintMasters contact met je opneemt. Je kunt hieronder gewoon verder.</p>}
        </section>
      )}

      {s.step === 1 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>{props.advice.questions.inflow}</h1>
          <div className="choices choices-2" role="radiogroup" aria-label="Eenheid" data-field="unit" tabIndex={-1}>
            {([["kg", "In kilo's"], ["pieces", "In kledingstukken"], ["bags", "In zakken"], ["unknown", "Geen idee, help mij schatten"]] as const).map(([v, t]) => (
              <label key={v} className="choice"><input type="radio" name="unit" value={v} checked={s.unit === v} onChange={() => set("unit", v)} /><span className="title">{t}</span></label>
            ))}
          </div>
          {err("unit")}
          {s.unit && s.unit !== "unknown" && inp("amount", s.unit === "kg" ? "Kilo per maand" : s.unit === "pieces" ? "Kledingstukken per maand" : "Zakken per maand", s.amount, (v) => set("amount", v), { mode: "decimal", help: s.unit === "bags" ? `We rekenen met ongeveer ${props.advice.kgPerBag} kg per zak.` : s.unit === "pieces" ? `We rekenen met ongeveer ${props.advice.kgPerPiece} kg per kledingstuk.` : undefined })}
          {s.unit === "unknown" && (
            <div className="card stack">
              {inp("employees", props.advice.questions.employees, s.employees, (v) => set("employees", v.replace(/\D/g, "")), { mode: "numeric" })}
              <fieldset className="stack" data-field="replacement" tabIndex={-1}>
                <legend>{props.advice.questions.replacement}</legend>
                {props.advice.replacementPerYear.map((o) => (
                  <label key={o.value} className="check"><input type="radio" name="replacement" checked={s.replacement === String(o.value)} onChange={() => set("replacement", String(o.value))} />{o.label}</label>
                ))}
                {err("replacement")}
              </fieldset>
            </div>
          )}
          {s.unit && inp("stock", `${props.advice.questions.stock} Hoeveel kilo ongeveer?`, s.stock, (v) => set("stock", v), { mode: "decimal", optional: true })}
        </section>
      )}

      {s.step === 2 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Ons advies</h1>
          {advice ? (
            <div className="card stack">
              <span className="pill pill-accent">Advies: {props.boxes.find((b) => b.size === advice.recommended)?.label}</span>
              <p style={{ fontSize: "1.1rem" }}>{advice.reason}</p>
              <p className="small muted">{advice.estimateNote}</p>
            </div>
          ) : <p className="muted">{quoting ? "Advies berekenen…" : "Vul de hoeveelheid in voor een advies. Je kunt ook zelf kiezen."}</p>}
          <div className="choices choices-3" role="radiogroup" aria-label="Boxformaat" data-field="boxSize" tabIndex={-1}>
            {props.boxes.map((b) => {
              const o = offers?.find((x) => x.boxSize === b.size);
              const base = offers?.find((x) => x.boxSize === advice?.recommended);
              const diff = o && base && o.monthlyCents !== null && base.monthlyCents !== null ? o.monthlyCents - base.monthlyCents : null;
              return (
                <label key={b.size} className="choice">
                  <input type="radio" name="box" value={b.size} checked={s.boxSize === b.size} onChange={() => set("boxSize", b.size)} />
                  {advice?.recommended === b.size && <span className="badge pill pill-accent">Advies</span>}
                  <img src={b.imageUrl} alt="" width={120} height={130} style={{ display: "block", margin: "0 auto 8px", maxWidth: 110 }} />
                  <span className="title">{b.label}</span>
                  <span className="sub">Ongeveer {b.capacityKg} kg · {formatEuro(b.monthlyCents)} per maand</span>
                  {diff !== null && diff !== 0 && <span className="sub">{diff > 0 ? "+" : "−"}{formatEuro(Math.abs(diff))} per maand t.o.v. advies</span>}
                </label>
              );
            })}
          </div>
          {err("boxSize")}
          <p className="small muted">Een maatje groter kan altijd. Je kunt later ook wisselen.</p>
        </section>
      )}

      {s.step === 3 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Kies je pakket</h1>
          <div className="choices" role="radiogroup" aria-label="Pakket" data-field="packageCode" tabIndex={-1}>
            {visiblePackages.map((p) => (
              <label key={p.code} className="choice">
                <input type="radio" name="pkg" value={p.code} checked={s.packageCode === p.code} onChange={() => { set("packageCode", p.code); if (p.kind === "scheduled" && !s.frequency) set("frequency", p.frequencies[0]?.perYear ?? null); }} />
                <span className="title">{p.name}</span><span className="sub">{p.tagline}</span>
              </label>
            ))}
          </div>
          {err("packageCode")}
          {pkg?.kind === "scheduled" && (
            <fieldset className="stack">
              <legend>Hoe vaak legen per jaar?</legend>
              <div className="row">
                {pkg.frequencies.map((f) => (
                  <label key={f.perYear} className="choice" style={{ width: "auto", flex: "1 1 120px" }}>
                    <input type="radio" name="freq" checked={s.frequency === f.perYear} onChange={() => set("frequency", f.perYear)} />
                    <span className="title">{f.perYear}× per jaar</span><span className="sub">{f.discountBp / 100}% korting</span>
                  </label>
                ))}
              </div>
              {advice?.suggestedFrequency && <p className="small muted">Op basis van jullie hoeveelheid past {advice.suggestedFrequency}× per jaar.</p>}
            </fieldset>
          )}
          {inp("postcode", "Postcode van de plaatsingslocatie", s.postcode, (v) => set("postcode", v.toUpperCase()), { auto: "postal-code", help: "Nodig om het vervoer te berekenen." })}
          {outside && (
            <div className="notice notice-warn stack" role="status">
              <p style={{ margin: 0 }}>Deze postcode ligt buiten ons standaard werkgebied ({props.planning.workAreaName}). We maken graag een voorstel op maat.</p>
              <a className="btn btn-sm" href={`/maatwerk?postcode=${encodeURIComponent(s.postcode)}&box=${s.boxSize ?? ""}`}>Vraag een voorstel op maat</a>
            </div>
          )}
          {quoteError && <p className="notice notice-danger">{quoteError}</p>}
          {pkg && !outside && priceSummary}
        </section>
      )}

      {s.step === 4 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Naar wie sturen we het voorstel?</h1>
          {inp("company.name", "Bedrijfsnaam", s.companyName, (v) => set("companyName", v), { auto: "organization" })}
          {inp("company.contactName", "Contactpersoon", s.contactName, (v) => set("contactName", v), { auto: "name" })}
          {inp("company.email", "E-mailadres", s.email, (v) => set("email", v), { type: "email", auto: "email", help: "Hier ontvang je het voorstel en je toegang tot Mijn Bereyl." })}
          {inp("company.phone", "Telefoonnummer voor afstemming", s.phone, (v) => set("phone", v), { type: "tel", auto: "tel" })}
          {inp("company.coc", "KvK-nummer", s.coc, (v) => set("coc", v), { optional: true, mode: "numeric" })}
        </section>
      )}

      {s.step === 5 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Waar komt de box te staan?</h1>
          {inp("location.street", "Straat en huisnummer", s.street, (v) => set("street", v), { auto: "street-address" })}
          <div className="grid grid-2">
            {inp("location.postcode", "Postcode", s.postcode, (v) => set("postcode", v.toUpperCase()), { auto: "postal-code" })}
            {inp("location.city", "Plaats", s.city, (v) => set("city", v), { auto: "address-level2" })}
          </div>
          <div className="field">
            <label htmlFor="q-instructions">Locatie-instructies <span className="muted small">(optioneel)</span></label>
            <textarea id="q-instructions" value={s.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Bijvoorbeeld: melden bij de receptie, box naast de laaddeur" />
          </div>
          <div className="field">
            <label htmlFor="q-note">Opmerkingen <span className="muted small">(optioneel)</span></label>
            <textarea id="q-note" value={s.note} onChange={(e) => set("note", e.target.value)} />
          </div>
          <div className="card stack">
            <h2 style={{ fontSize: "1.15rem" }}>Factuurgegevens</h2>
            {inp("invoice.email", "Factuurmailadres", s.invEmail, (v) => set("invEmail", v), { type: "email", optional: true, help: `Leeg laten = ${s.email || "het e-mailadres van de contactpersoon"}` })}
            <label className="check"><input type="checkbox" checked={s.invDifferent} onChange={(e) => set("invDifferent", e.target.checked)} />Het factuuradres wijkt af van het plaatsingsadres</label>
            {s.invDifferent && (
              <div className="stack">
                {inp("invoice.attn", "T.a.v.", s.invAttn, (v) => set("invAttn", v), { optional: true })}
                {inp("invoice.street", "Straat en huisnummer", s.invStreet, (v) => set("invStreet", v))}
                <div className="grid grid-2">
                  {inp("invoice.postcode", "Postcode", s.invPostcode, (v) => set("invPostcode", v.toUpperCase()))}
                  {inp("invoice.city", "Plaats", s.invCity, (v) => set("invCity", v))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {s.step === 6 && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Wanneer komt het jullie uit?</h1>
          <p className="muted">Kies één of meer voorkeursdagen. Dit is een aanvraag: Bereyl bevestigt de afspraak.</p>
          <PreferencePicker
            flexible={s.flexible} slots={s.slots} dayparts={props.planning.dayparts} days={props.planning.days}
            minLeadDays={props.planning.minLeadDays} max={props.planning.maxPreferences}
            onChange={(flexible, slots) => setS((c) => ({ ...c, flexible, slots }))}
            error={errors["preferences.slots"] ?? errors["preferences"]}
          />
        </section>
      )}

      {s.step === 7 && offer && (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>Nog één stap dichter bij een duurzame toekomst</h1>
          <div className="card stack">
            <p style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>{offer.boxLabel} · {s.city || s.postcode} · {s.flexible ? "Flexibele plaatsing" : `${s.slots.length} voorkeur${s.slots.length === 1 ? "" : "en"}`}</p>
            <p style={{ margin: 0 }}><span className="price-big">{offer.monthlyCents === null ? "Nog vast te stellen" : formatEuro(offer.monthlyCents)}</span> <span className="muted">per maand excl. btw · {offer.packageName}</span></p>
            <div>
              {[
                { title: "PrintMasters", step: 0, body: { customer: "Ja, we zijn klant (wordt gecontroleerd)", intro: "Nog niet, ik wil kennismaken", no: "Nee, alleen Bereyl" }[s.printmasters ?? "no"] },
                { title: "Hoeveelheid", step: 1, body: s.unit === "unknown" ? `${s.employees} medewerkers, ${s.replacement}× per jaar vervangen` : `${s.amount} ${s.unit === "kg" ? "kg" : s.unit === "pieces" ? "kledingstukken" : "zakken"} per maand${s.stock ? ` + ${s.stock} kg opruimvoorraad` : ""}` },
                { title: "Box", step: 2, body: `${offer.boxLabel}${advice && advice.recommended !== offer.boxSize ? ` (advies was ${advice.recommended} liter)` : ""}` },
                { title: "Pakket en prijs", step: 3, body: <dl className="kv small">{offer.lines.map((l, i) => <div key={i} style={{ display: "contents" }}><dt>{l.label}</dt><dd>{l.cents === null ? "nog vast te stellen" : formatEuro(l.cents)}</dd></div>)}</dl> },
                { title: "Bedrijf", step: 4, body: `${s.companyName} · ${s.contactName} · ${s.email} · ${s.phone}` },
                { title: "Plaatsing en factuur", step: 5, body: `${s.street}, ${s.postcode} ${s.city}${s.invDifferent ? ` · Factuur: ${s.invStreet}, ${s.invPostcode} ${s.invCity}` : ""}${s.invEmail ? ` · Factuurmail: ${s.invEmail}` : ""}` },
                { title: "Voorkeur", step: 6, body: s.flexible ? "Het maakt ons niet uit, plan ons in overleg in" : s.slots.map((x) => `${x.date}${x.daypart ? " " + (props.planning.dayparts.find((d) => d.code === x.daypart)?.label ?? "") : ""}`).join(", ") },
              ].map((d) => (
                <details key={d.title} className="summary-item">
                  <summary><span>{d.title}</span><span className="small muted">Details</span></summary>
                  <div className="stack" style={{ paddingTop: 8 }}>
                    <div>{d.body}</div>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => go(d.step)}>Wijzig {d.title.toLowerCase()}</button>
                  </div>
                </details>
              ))}
            </div>
            {offer.notes.map((n, i) => <p key={i} className="small notice notice-warn" style={{ margin: 0 }}>{n}</p>)}
          </div>
          {Object.keys(errors).length > 0 && (
            <div className="notice notice-danger" role="alert">
              <p style={{ margin: 0 }}>{submitError}</p>
              <ul>{Object.entries(errors).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
            </div>
          )}
          {submitError && Object.keys(errors).length === 0 && <p className="notice notice-danger" role="alert">{submitError}</p>}
          <p className="muted">Je ontvangt per e-mail een PDF van het voorstel en toegang tot Mijn Bereyl om akkoord te geven.</p>
          <button type="button" className="btn btn-block" onClick={submit} disabled={pending} aria-busy={pending}>{pending ? "Versturen…" : "Stuur mijn voorstel"}</button>
        </section>
      )}
      {s.step === 7 && !offer && <p className="muted" role="status">Prijs berekenen…</p>}

      {s.step < 7 && (
        <div className="row between">
          <span />
          <button type="button" className="btn" onClick={next} disabled={s.step === 3 && outside}>
            {s.step === 2 ? "Naar pakket en prijs" : s.step === 3 ? "Ziet er goed uit, verder" : "Volgende"}
          </button>
        </div>
      )}
    </div>
  );
}

