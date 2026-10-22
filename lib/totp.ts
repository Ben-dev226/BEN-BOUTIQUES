import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238) : 6 chiffres, pas de 30 s, SHA-1 — compatible Google Authenticator, Authy, 1Password, Aegis… */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newSecret = () => { const b = randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const unb32 = (s: string) => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) throw new Error('secret invalide'); bits += v.toString(2).padStart(5, '0'); } const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export const hotp = (secret: string, counter: number) => {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unb32(secret)).update(buf).digest(), o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, '0');
};
/** Retourne le pas (30 s) validé, ou null. Tolère ±1 pas (décalage d'horloge) ; `after` interdit de rejouer un code déjà utilisé. */
export function verifyTotp(secret: string, code: string, after = 0, now = Date.now()): number | null {
  const c = String(code).replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const s = step + d; if (s <= after) continue;
    const a = Buffer.from(hotp(secret, s)), b = Buffer.from(c);
    if (a.length === b.length && timingSafeEqual(a, b)) return s;
  }
  return null;
}
export const otpauthUri = (secret: string, account: string, issuer: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
