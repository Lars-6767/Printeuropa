import Link from "next/link";

export function PageHead({ title, intro, back, actions }: { title: string; intro?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      {back && <p className="small"><Link href={back.href}>← {back.label}</Link></p>}
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <h1 style={{ marginBottom: 4 }}>{title}</h1>
        {actions}
      </div>
      {intro && <p className="muted" style={{ maxWidth: 720 }}>{intro}</p>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card center stack" style={{ padding: "36px 20px" }}>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
      {action}
    </div>
  );
}

export function Pill({ children, tone }: { children: React.ReactNode; tone?: "accent" | "warn" | "danger" | "ok" | "muted" }) {
  return <span className={`pill${tone ? ` pill-${tone}` : ""}`}>{children}</span>;
}

export function KV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return <dl className="kv">{rows.map(([k, v], i) => <div key={i} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Flash({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const ok = searchParams?.ok;
  const err = searchParams?.fout;
  if (!ok && !err) return null;
  return <p className={`notice ${err ? "notice-danger" : "notice-ok"}`} role={err ? "alert" : "status"}>{String(err ?? ok)}</p>;
}
