export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const fcfa = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';

export function cleanStr(v: unknown, max = 255): string {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
/** Téléphone → chiffres ; 8 chiffres = numéro burkinabè (+226). */
export function normalizePhone(p: string): string {
  let d = (p || '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '226' + d;
  return d;
}
/** Texte brut avec **gras**, *italique*, listes "- " → HTML sûr. */
export function renderRich(t: string): string {
  let out = '', inList = false;
  for (const line of (t || '').trim().split(/\r?\n/)) {
    let e = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<em>$1</em>');
    e = e.replace(/\[([^\]]{1,120})\]\((https?:\/\/[^\s)"'<>]{1,300})\)/g, '<a href="$2" target="_blank" rel="noopener nofollow noreferrer">$1</a>');
    const hd = e.match(/^\s*##\s+(.*)$/);
    if (hd) { if (inList) { out += '</ul>'; inList = false; } out += `<h2>${hd[1]}</h2>`; continue; }
    const m = e.match(/^\s*[-•]\s+(.*)$/);
    if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; }
    else { if (inList) { out += '</ul>'; inList = false; } if (e.trim()) out += `<p>${e}</p>`; }
  }
  return out + (inList ? '</ul>' : '');
}
export const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const randHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** #RRGGBB → ajuste la luminosité (f<1 assombrit, f>1 éclaircit) */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

/** Accepte uniquement une URL http(s) valide (refuse javascript:, data:, etc.) ; renvoie l'URL normalisée ou null. */
export function safeHttpUrl(v: unknown): string | null {
  try { const u = new URL(String(v).trim()); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}

/** Découpe « ## Question » + réponse en paires. */
export function parseFaq(t: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = []; let cur: { q: string; a: string } | null = null;
  for (const line of (t || '').split(/\r?\n/)) {
    const m = line.match(/^\s*##\s+(.*)$/);
    if (m) { cur = { q: m[1].trim(), a: '' }; out.push(cur); } else if (cur) cur.a += line + '\n';
  }
  return out.map(x => ({ q: x.q, a: x.a.trim() })).filter(x => x.q && x.a);
}
