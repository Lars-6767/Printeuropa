import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getConfigs } from "@/lib/settings";
import { Quiz } from "./Quiz";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vind mijn box" };

export default async function KeuzehulpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cfg = await getConfigs(["pricing", "packages", "printmasters", "advice", "planning", "contract"]);
  const boxParam = sp.box;
  const boxValid = boxParam === undefined || ["250", "500", "1000"].includes(boxParam);
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          {!boxValid && <p className="notice notice-warn" role="status">Het boxformaat &lsquo;{boxParam}&rsquo; bestaat niet. We helpen je hieronder het juiste formaat te kiezen.</p>}
          <Quiz
            initial={{ box: boxValid && boxParam ? Number(boxParam) : null, pakket: sp.pakket ?? null, postcode: sp.postcode ?? null }}
            boxes={cfg.pricing.boxes.filter((b) => b.available)}
            packages={cfg.packages.items.filter((p) => p.active && !p.archived)}
            pmRule={cfg.printmasters.rules.find((r) => r.active) ?? null}
            advice={cfg.advice}
            planning={{ dayparts: cfg.planning.dayparts, days: cfg.planning.days, minLeadDays: cfg.planning.minLeadDays, maxPreferences: cfg.planning.maxPreferences, workAreaName: cfg.planning.workAreaName }}
            vatBp={cfg.pricing.vatBp}
          />
        </div>
      </main>
    </>
  );
}
