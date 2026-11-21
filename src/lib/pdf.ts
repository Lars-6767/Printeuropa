/** PDF-opbouw met pdfkit. Opmaak en zichtbare onderdelen komen uit de PDF-instellingen in beheer. */
import PDFDocument from "pdfkit";
import type { PdfConfig } from "./config";

const INK = "#283106";
const MUTED = "#5E6448";
const SOFT = "#D1D8BD";

type Row = [string, string];
export interface PdfSection { title: string; rows?: Row[]; text?: string }

export async function buildPdf(opts: {
  cfg: PdfConfig;
  title: string;
  subtitle?: string;
  meta?: Row[];
  intro?: string;
  sections: PdfSection[];
  footerNote?: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: opts.title, Author: "Bereyl" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const accent = /^#[0-9a-f]{6}$/i.test(opts.cfg.accentColor) ? opts.cfg.accentColor : "#B9D53A";

  // Kop
  doc.rect(0, 0, doc.page.width, 8).fill(accent);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text("Bereyl", 50, 40);
  doc.circle(132, 50, 4).fill(accent);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(opts.title, 50, 85);
  if (opts.subtitle) doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(opts.subtitle);
  doc.moveDown(0.8);
  if (opts.meta?.length) table(doc, opts.meta);
  if (opts.intro) {
    doc.moveDown(0.5).font("Helvetica").fontSize(11).fillColor(INK).text(opts.intro, { lineGap: 2 });
  }
  for (const s of opts.sections) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.9);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(s.title);
    const y = doc.y + 3;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(1).strokeColor(SOFT).stroke();
    doc.moveDown(0.5);
    if (s.text) doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(s.text, { lineGap: 2 });
    if (s.rows?.length) table(doc, s.rows);
  }
  if (opts.footerNote) {
    doc.moveDown(1.2).font("Helvetica").fontSize(9.5).fillColor(MUTED).text(opts.footerNote, { lineGap: 1.5 });
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`${opts.cfg.footer} · pagina ${i + 1} van ${range.count}`, 50, doc.page.height - 40, { width: doc.page.width - 100, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}

function table(doc: PDFKit.PDFDocument, rows: Row[]) {
  const left = 50;
  const labelW = 190;
  const valueW = doc.page.width - 100 - labelW;
  for (const [label, value] of rows) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(label, left, y, { width: labelW - 10 });
    const h1 = doc.y - y;
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(value || "–", left + labelW, y, { width: valueW });
    const h2 = doc.y - y;
    doc.y = y + Math.max(h1, h2) + 3;
    doc.x = left;
  }
}
