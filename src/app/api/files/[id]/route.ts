/** Geautoriseerde download van documenten en foto's. Rechten worden per document gecontroleerd. */
import { NextResponse } from "next/server";
import { currentUser, activeMemberships } from "@/lib/auth";
import { canAccessFile } from "@/lib/access";
import { one } from "@/lib/db";
import { readFile } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return new NextResponse("Log in om dit document te bekijken.", { status: 401 });
  const fileId = Number(id);
  if (!Number.isInteger(fileId)) return new NextResponse("Niet gevonden", { status: 404 });
  const ms = await activeMemberships(user.id);
  const allowed = await canAccessFile(fileId, { staffRole: user.staff_role, companyIds: ms.map((m) => m.company_id) });
  if (!allowed) return new NextResponse("Niet gevonden", { status: 404 });
  const f = await one<{ path: string; mime: string; filename: string }>(`SELECT path, mime, filename FROM files WHERE id=$1`, [fileId]);
  const data = await readFile(f!.path);
  const inline = new URL(req.url).searchParams.get("download") !== "1";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": f!.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f!.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(f!.mime === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    },
  });
}
