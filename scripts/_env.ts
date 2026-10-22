// Charge .env.local / .env pour les scripts en ligne de commande (Next le fait seul pour l'application).
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
export const arg = (name: string, d = ''): string => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] ?? d : d; };
export const has = (name: string) => process.argv.includes('--' + name);
