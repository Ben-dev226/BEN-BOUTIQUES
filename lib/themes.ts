import { shade, isHex } from './util';

/** Personnalisation de la vitrine : thèmes de saison, couleurs, polices, forme. Tout est validé côté serveur (lisibilité comprise). */
export type Look = { primary: string; dark: string; bg: string };
export type Preset = Look & { id: string; label: string; decor: '' | 'snow' | 'sparkle' | 'hearts' | 'moon' | 'confetti' | 'flower'; hint: string };

export const DEFAULT_LOOK: Look = { primary: '#D91B1B', dark: '#0E0E0E', bg: '#F5F0EB' };

export const PRESETS: Preset[] = [
  { id: 'noel', label: 'Noël', primary: '#B3141F', dark: '#0F3D2E', bg: '#FBF6EE', decor: 'snow', hint: 'Rouge, vert sapin et neige légère' },
  { id: 'nouvel_an', label: 'Nouvel An', primary: '#9A6B00', dark: '#0B1026', bg: '#F8F5EC', decor: 'sparkle', hint: 'Or et bleu nuit, étincelles' },
  { id: 'saint_valentin', label: 'Saint-Valentin', primary: '#C2255C', dark: '#3A0B1F', bg: '#FFF4F6', decor: 'hearts', hint: 'Rose profond et coeurs' },
  { id: 'ramadan', label: 'Ramadan', primary: '#0B7A6B', dark: '#0A2E2A', bg: '#F6F2E7', decor: 'moon', hint: 'Vert profond, croissants et étoiles' },
  { id: 'tabaski', label: 'Tabaski et Aïd', primary: '#14724B', dark: '#10261C', bg: '#F7F3E8', decor: 'moon', hint: 'Vert et ivoire, croissants' },
  { id: 'black_friday', label: 'Black Friday', primary: '#E5460C', dark: '#000000', bg: '#F1F1F1', decor: 'confetti', hint: 'Noir et orange, confettis' },
  { id: 'soldes', label: 'Soldes', primary: '#0B6BCB', dark: '#0A1F3C', bg: '#F2F6FB', decor: 'confetti', hint: 'Bleu franc et confettis' },
  { id: 'rentree', label: 'Rentrée scolaire', primary: '#B45309', dark: '#1F2A44', bg: '#FBF5EA', decor: '', hint: 'Ambre et bleu ardoise, sobre' },
  { id: 'fete_meres', label: 'Fête des mères', primary: '#A63D6F', dark: '#3B1830', bg: '#FFF5F8', decor: 'flower', hint: 'Rose et fleurs' },
];
export const PALETTES: (Look & { id: string; label: string })[] = [
  { id: 'classique', label: 'Rouge classique', ...DEFAULT_LOOK },
  { id: 'nature', label: 'Vert nature', primary: '#1F7A4D', dark: '#10261C', bg: '#F4F7F0' },
  { id: 'nuit', label: 'Bleu nuit', primary: '#1D4ED8', dark: '#0B1630', bg: '#F3F6FB' },
  { id: 'or', label: 'Or et noir', primary: '#9A6B00', dark: '#111111', bg: '#F7F3E8' },
  { id: 'rose', label: 'Rose poudré', primary: '#C2417A', dark: '#3B1226', bg: '#FFF4F7' },
  { id: 'terre', label: 'Terre cuite', primary: '#B4532A', dark: '#2B1A12', bg: '#F8F1E9' },
  { id: 'violet', label: 'Violet', primary: '#6D28D9', dark: '#1E1233', bg: '#F6F3FB' },
];

export const FONTS: Record<string, { label: string; head: string; body: string; css: string }> = {
  classic: { label: 'Classique (serif élégant)', head: "'Playfair Display',Georgia,serif", body: "'Outfit',system-ui,-apple-system,Segoe UI,sans-serif", css: 'family=Outfit:wght@400;500;600;700&family=Playfair+Display:wght@700;900' },
  moderne: { label: 'Moderne (net et lisible)', head: "'Poppins',system-ui,sans-serif", body: "'Inter',system-ui,-apple-system,Segoe UI,sans-serif", css: 'family=Inter:wght@400;500;600&family=Poppins:wght@600;700' },
  elegant: { label: 'Élégant (luxe, mode)', head: "'Cormorant Garamond',Georgia,serif", body: "'Montserrat',system-ui,sans-serif", css: 'family=Cormorant+Garamond:wght@600;700&family=Montserrat:wght@400;500;600' },
  chaleureux: { label: 'Chaleureux (arrondi)', head: "'Baloo 2',system-ui,sans-serif", body: "'Nunito',system-ui,sans-serif", css: 'family=Baloo+2:wght@600;700&family=Nunito:wght@400;600;700' },
};
export const RADII: Record<string, { label: string; r: string; shadow: string }> = {
  soft: { label: 'Arrondi léger (par défaut)', r: '6px', shadow: '4px 4px 0 var(--ink)' },
  sharp: { label: 'Angles droits', r: '0px', shadow: '4px 4px 0 var(--ink)' },
  round: { label: 'Très arrondi', r: '16px', shadow: '0 8px 22px rgba(0,0,0,.14)' },
};

// ── Couleurs : luminance, contraste, mélange ──
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const lum = (h: string) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const mix = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

/** Vérifie une combinaison de couleurs ; renvoie un message d'erreur lisible ou null. */
export function lookProblem(l: Look): string | null {
  if (lum(l.bg) < 0.45) return 'Le fond de la boutique doit rester clair (le texte est foncé).';
  if (lum(l.dark) > 0.18) return 'La couleur sombre (bandeau, pied de page) doit rester foncée pour que le texte clair soit lisible.';
  if (contrast(l.primary, l.bg) < 2.6) return 'La couleur principale est trop proche du fond : prix et liens seraient difficiles à lire. Choisissez une teinte plus foncée.';
  return null;
}

// ── Occasions : suggestions selon la date ──
const iso = (d: Date) => d.toISOString().slice(0, 10);
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86400000);
/** 4e vendredi de novembre. */
const blackFriday = (y: number) => { const first = d(y, 11, 1), dow = first.getUTCDay(); return addDays(first, ((5 - dow + 7) % 7) + 21); };
/** Dates lunaires approximatives (à confirmer chaque année) : [début Ramadan, Aïd el-Fitr, Tabaski]. */
const LUNAR: Record<number, [string, string, string]> = { 2027: ['2027-02-08', '2027-03-10', '2027-05-17'], 2028: ['2028-01-28', '2028-02-26', '2028-05-05'], 2029: ['2029-01-16', '2029-02-14', '2029-04-24'] };

export type Occasion = { preset: string; label: string; from: string; to: string; approx?: boolean; announcement: string };
export function occasions(year: number): Occasion[] {
  const out: Occasion[] = [
    { preset: 'saint_valentin', label: 'Saint-Valentin', from: iso(d(year, 2, 1)), to: iso(d(year, 2, 14)), announcement: 'Saint-Valentin : offrez un cadeau qui lui ressemble. Commande simple sur WhatsApp.' },
    { preset: 'fete_meres', label: 'Fête des mères', from: iso(d(year, 5, 18)), to: iso(d(year, 5, 31)), approx: true, announcement: 'Fête des mères : gâtez celle qui compte. Livraison rapide, confirmation par WhatsApp.' },
    { preset: 'rentree', label: 'Rentrée scolaire', from: iso(d(year, 9, 1)), to: iso(d(year, 10, 10)), approx: true, announcement: 'Rentrée : nouveautés et prix doux pour bien démarrer.' },
    { preset: 'black_friday', label: 'Black Friday', from: iso(addDays(blackFriday(year), -3)), to: iso(addDays(blackFriday(year), 3)), announcement: 'Black Friday : des prix cassés, quantités limitées. Commandez vite sur WhatsApp.' },
    { preset: 'noel', label: 'Noël', from: iso(d(year, 12, 1)), to: iso(d(year, 12, 26)), announcement: 'Joyeuses fêtes ! Idées cadeaux et livraison avant Noël, commandez dès maintenant.' },
    { preset: 'nouvel_an', label: 'Nouvel An', from: iso(d(year, 12, 27)), to: iso(d(year + 1, 1, 5)), announcement: 'Bonne année ! Démarrez avec nos nouveautés.' },
  ];
  const l = LUNAR[year];
  if (l) {
    out.push({ preset: 'ramadan', label: 'Ramadan', from: l[0], to: iso(addDays(new Date(l[1] + 'T00:00:00Z'), -1)), approx: true, announcement: 'Ramadan Mubarak : retrouvez notre sélection pour le mois béni.' });
    out.push({ preset: 'tabaski', label: 'Aïd el-Fitr', from: iso(addDays(new Date(l[1] + 'T00:00:00Z'), -10)), to: l[1], approx: true, announcement: 'Aïd Mubarak : de belles tenues et des cadeaux pour la fête.' });
    out.push({ preset: 'tabaski', label: 'Tabaski', from: iso(addDays(new Date(l[2] + 'T00:00:00Z'), -14)), to: l[2], approx: true, announcement: 'Tabaski : préparez la fête avec nos nouveautés. Livraison rapide.' });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}
/** Occasion en cours ou à venir dans les 60 jours (la plus proche d'abord). */
export function upcoming(today: string): (Occasion & { starts_in: number; active: boolean })[] {
  const t = new Date(today + 'T00:00:00Z'), y = t.getUTCFullYear();
  return [...occasions(y), ...occasions(y + 1)]
    .map(o => ({ ...o, starts_in: Math.round((Date.parse(o.from + 'T00:00:00Z') - t.getTime()) / 86400000), active: today >= o.from && today <= o.to }))
    .filter(o => (o.active || (o.starts_in >= 0 && o.starts_in <= 60)) && today <= o.to)
    .sort((a, b) => (a.active === b.active ? a.starts_in - b.starts_in : a.active ? -1 : 1));
}

// ── Rendu : variables CSS effectives ──
export type LookSettings = Record<string, string>;
export function resolveLook(s: LookSettings, today = iso(new Date())): { vars: string; decor: string; fontCss: string; presetId: string; primary: string } {
  const preset = PRESETS.find(p => p.id === s.theme);
  const inWindow = !!preset && (!s.theme_from || today >= s.theme_from) && (!s.theme_to || today <= s.theme_to);
  const own: Look = {
    primary: isHex(s.primary_color) ? s.primary_color : DEFAULT_LOOK.primary,
    dark: isHex(s.color_dark) ? s.color_dark : DEFAULT_LOOK.dark,
    bg: isHex(s.color_bg) ? s.color_bg : DEFAULT_LOOK.bg,
  };
  const L: Look = inWindow && preset ? preset : lookProblem(own) ? DEFAULT_LOOK : own;
  const font = FONTS[s.font] || FONTS.classic, rad = RADII[s.radius] || RADII.soft;
  const onRed = contrast('#ffffff', L.primary) >= 3 ? '#ffffff' : '#0E0E0E';
  const vars = `--red:${L.primary};--red-d:${shade(L.primary, 0.72)};--red-l:${shade(L.primary, 1.18)};--on-red:${onRed};--ink:${L.dark};--paper:${L.bg};--cream:${mix(L.bg, L.dark, 0.07)};--line:${mix(L.bg, L.dark, 0.16)};--muted:${mix(L.dark, L.bg, 0.4)};--r:${rad.r};--shadow:${rad.shadow};--head:${font.head};--body:${font.body}`;
  return { vars, decor: inWindow && preset ? preset.decor : '', fontCss: font.css, presetId: inWindow && preset ? preset.id : '', primary: L.primary };
}
