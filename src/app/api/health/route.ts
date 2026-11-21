import { NextResponse } from "next/server";
import { one } from "@/lib/db";
export async function GET() {
  const r = await one<{ ok: number }>(`SELECT 1 AS ok`);
  return NextResponse.json({ ok: r?.ok === 1 });
}
