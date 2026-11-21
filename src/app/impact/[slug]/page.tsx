import { notFound } from "next/navigation";
import { Header, Footer } from "@/components/Header";
import { one } from "@/lib/db";
import { companyImpact } from "@/lib/impact";
import { formatKg } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Publieke klant-impactpagina: alleen als de klant dit zelf heeft aangezet, en alleen gekozen onderdelen. */
export default async function PublicImpact({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await one<any>(`SELECT * FROM companies WHERE public_slug=$1 AND public_enabled`, [slug]);
  if (!c) notFound();
  const imp = await companyImpact(c.id);
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="hero-card stack center">
            {c.public_show_logo && c.logo_file_id && <img src={`/api/publiek/logo/${c.public_slug}`} alt={`Logo ${c.name}`} style={{ maxHeight: 80, margin: "0 auto" }} />}
            <h1>{c.public_show_name ? c.name : "Deze organisatie"} zamelt in met Bereyl</h1>
            {c.public_show_totals && (
              <>
                <p className="impact-number">{formatKg(imp.grams)}</p>
                <p>bedrijfskleding ingezameld in {imp.executedEmptyings} legingen</p>
              </>
            )}
            <p className="muted small">Gewichten zijn bevestigde wegingen.</p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
