import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { readFile } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = await one<{ path: string; mime: string }>(
    `SELECT f.path, f.mime FROM companies c JOIN files f ON f.id=c.logo_file_id WHERE c.public_slug=$1 AND c.public_enabled AND c.public_show_logo`, [slug]);
  if (!f) return new NextResponse("Niet gevonden", { status: 404 });
  return new NextResponse(new Uint8Array(await readFile(f.path)), { headers: { "Content-Type": f.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
