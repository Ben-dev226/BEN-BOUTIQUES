import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { Result } from './reports';

const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const cellText = (v: unknown, type: string) => v === null || v === undefined ? '' : typeof v === 'number' ? (type === 'pct' ? `${v} %` : type === 'money' ? num(v) : type === 'int' ? num(v) : String(v)) : String(v);
/** Les polices PDF standard ne couvrent que le jeu WinAnsi : on remplace le reste. */
const safe = (s: string, f: PDFFont) => Array.from(s.replace(/[\r\n\t]+/g, ' ').replace(/[  ]/g, ' ')).map(ch => { try { f.encodeText(ch); return ch; } catch { return '?'; } }).join('');

export async function toPdf(r: Result, meta: { shop: string; color?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const wide = r.columns.length > 5, W = wide ? 841.89 : 595.28, H = wide ? 595.28 : 841.89, M = 36, usable = W - 2 * M, fs = 8.5, rowH = 17;
  const hex = /^#[0-9a-f]{6}$/i.test(meta.color || '') ? meta.color! : '#0D3B2C', ink = rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  // largeurs : proportionnelles au contenu, bornées, puis ajustées à la page
  const want = r.columns.map((c, i) => Math.min(190, Math.max(40, bold.widthOfTextAtSize(safe(c.label, bold), fs) + 12, ...r.rows.slice(0, 150).map(rw => font.widthOfTextAtSize(safe(cellText(rw[i], c.type), font), fs) + 12))));
  const k = usable / want.reduce((a, b) => a + b, 0), cw = want.map(w => (k < 1 ? w * k : w + (usable - want.reduce((a, b) => a + b, 0)) / want.length * (k > 1.4 ? 0 : 1)));
  const fit = (t: string, w: number, f: PDFFont) => { t = safe(t, f); if (f.widthOfTextAtSize(t, fs) <= w - 8) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', fs) > w - 8) t = t.slice(0, -1); return t + '...'; };
  const pages: ReturnType<PDFDocument['addPage']>[] = [];
  let page = doc.addPage([W, H]), y = H - M;
  const head = (first: boolean) => {
    if (first) {
      page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ink });
      page.drawText(safe(meta.shop, bold), { x: M, y: y - 6, size: 16, font: bold, color: ink });
      page.drawText(safe(r.title, font), { x: M, y: y - 24, size: 10.5, font, color: rgb(.2, .2, .2) });
      page.drawText(`Généré le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, { x: M, y: y - 38, size: 8, font, color: rgb(.45, .45, .45) });
      y -= 56;
    }
    page.drawRectangle({ x: M, y: y - rowH + 4, width: usable, height: rowH, color: rgb(.86, .92, .89) });
    let x = M; r.columns.forEach((c, i) => { const right = c.type !== 'text'; const t = fit(c.label, cw[i], bold); page.drawText(t, { x: right ? x + cw[i] - 4 - bold.widthOfTextAtSize(t, fs) : x + 4, y: y - 8, size: fs, font: bold, color: rgb(.05, .15, .1) }); x += cw[i]; });
    y -= rowH;
  };
  pages.push(page); head(true);
  const line = (vals: unknown[], b: boolean, zebra: boolean) => {
    if (y - rowH < M + 14) { page = doc.addPage([W, H]); pages.push(page); y = H - M; head(false); }
    if (zebra) page.drawRectangle({ x: M, y: y - rowH + 4, width: usable, height: rowH, color: rgb(.965, .975, .97) });
    if (b) page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + usable, y: y + 4 }, thickness: .8, color: ink });
    let x = M; r.columns.forEach((c, i) => { const f = b ? bold : font, t = fit(cellText(vals[i], c.type), cw[i], f); page.drawText(t, { x: c.type !== 'text' ? x + cw[i] - 4 - f.widthOfTextAtSize(t, fs) : x + 4, y: y - 8, size: fs, font: f, color: rgb(.1, .1, .1) }); x += cw[i]; });
    y -= rowH;
  };
  r.rows.slice(0, 3000).forEach((row, i) => line(row, false, i % 2 === 1));
  if (r.rows.length > 3000) line(['… ' + (r.rows.length - 3000) + ' lignes de plus : utilisez l\'export Excel ou CSV'], false, false);
  if (!r.rows.length) line(['Aucune donnée sur cette période'], false, false);
  if (r.totals) line(r.totals, true, false);
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} / ${pages.length}`, { x: W - M - 50, y: 18, size: 8, font, color: rgb(.5, .5, .5) }));
  return doc.save();
}
