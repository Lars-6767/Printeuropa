/** Toegangsregels voor documenten. Klanten zien uitsluitend hun eigen bestanden en aan hen vrijgegeven certificaten. */
import { one } from "./db";

export async function canAccessFile(fileId: number, who: { staffRole: string | null; companyIds: number[] }): Promise<boolean> {
  const f = await one<{ id: number; company_id: number | null; kind: string }>(`SELECT id, company_id, kind FROM files WHERE id=$1`, [fileId]);
  if (!f) return false;
  if (who.staffRole === "admin" || who.staffRole === "planner") return true;
  if (who.staffRole === "field") return f.kind === "photo";
  if (who.companyIds.length === 0) return false;
  if (f.kind === "certificate") {
    const r = await one(`SELECT 1 FROM certificate_releases cr JOIN certificates c ON c.id=cr.certificate_id WHERE c.file_id=$1 AND cr.company_id = ANY($2)`, [fileId, who.companyIds]);
    return Boolean(r);
  }
  if (f.kind === "statement") {
    const r = await one(`SELECT 1 FROM certificate_releases WHERE statement_file_id=$1 AND company_id = ANY($2)`, [fileId, who.companyIds]);
    return Boolean(r);
  }
  return f.company_id !== null && who.companyIds.includes(f.company_id);
}
