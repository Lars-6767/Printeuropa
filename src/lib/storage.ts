/** Afgeschermde bestandsopslag buiten de webroot. Bestanden worden alleen via geautoriseerde routes geserveerd. */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { one, type Db } from "./db";

export const ALLOWED_UPLOADS: Record<string, string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  certificate: ["application/pdf"],
  logo: ["image/png", "image/jpeg", "image/svg+xml", "image/webp"],
  terms: ["application/pdf"],
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function root() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

/** Controleert type aan de hand van de bestandsinhoud (magic bytes), niet alleen de opgegeven mime. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString("latin1").startsWith("ftyphei")) return "image/heic";
  const head = buf.subarray(0, 200).toString("utf8").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

export function validateUpload(kind: keyof typeof ALLOWED_UPLOADS, buf: Buffer): { ok: true; mime: string } | { ok: false; error: string } {
  if (buf.length === 0) return { ok: false, error: "Het bestand is leeg." };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Het bestand is groter dan 10 MB." };
  const mime = sniffMime(buf);
  if (!mime || !ALLOWED_UPLOADS[kind].includes(mime)) return { ok: false, error: "Dit bestandstype is niet toegestaan." };
  return { ok: true, mime };
}

export async function storeFile(
  db: Db,
  f: { companyId: number | null; kind: string; filename: string; mime: string; data: Buffer; uploadedBy?: number | null },
): Promise<number> {
  const sha = crypto.createHash("sha256").update(f.data).digest("hex");
  const rel = path.join(f.kind, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extFor(f.mime)}`);
  const abs = path.join(root(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, f.data);
  const row = await one<{ id: number }>(
    `INSERT INTO files(company_id, kind, path, filename, mime, size_bytes, sha256, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [f.companyId, f.kind, rel, safeName(f.filename), f.mime, f.data.length, sha, f.uploadedBy ?? null], db,
  );
  return row!.id;
}

export async function readFile(rel: string): Promise<Buffer> {
  const abs = path.resolve(root(), rel);
  if (!abs.startsWith(root() + path.sep)) throw new Error("Ongeldig pad");
  return fs.readFile(abs);
}

function extFor(mime: string) {
  return ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/svg+xml": ".svg" } as Record<string, string>)[mime] ?? "";
}
export function safeName(n: string) {
  return n.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "bestand";
}
