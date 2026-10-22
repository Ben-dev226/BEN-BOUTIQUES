/**
 * Domaines personnalisés via l'API Vercel.
 *  VERCEL_API_TOKEN   jeton (vercel.com/account/tokens)
 *  VERCEL_PROJECT_ID  identifiant ou nom du projet
 *  VERCEL_TEAM_ID     facultatif (projet d'une équipe)
 */
const base = () => (process.env.VERCEL_API_BASE || 'https://api.vercel.com').replace(/\/$/, '');
export const vercelEnabled = () => !!process.env.VERCEL_API_TOKEN && !!process.env.VERCEL_PROJECT_ID;
const q = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '');
const proj = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID!);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base() + path + (path.includes('?') ? q().replace('?', '&') : q()), {
    method, headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export const isApex = (d: string) => d.split('.').length === 2 || /\.(co|com|org|net|gov)\.[a-z]{2}$/.test(d) && d.split('.').length === 3;
export const domainsFor = (d: string) => (isApex(d) ? [d, 'www.' + d] : [d]);

export async function addDomain(domain: string): Promise<void> {
  for (const name of domainsFor(domain)) {
    const r = await call('POST', `/v10/projects/${proj()}/domains`, { name });
    if (r.status === 200) continue;
    const msg = r.json?.error?.message || '';
    if (r.status === 400 && /already exists|already.*project/i.test(msg)) continue;
    if (r.status === 409) throw new Error('Ce domaine est déjà utilisé par un autre projet Vercel.');
    console.error('[vercel] add', name, r.status, msg);
    throw new Error(r.status === 401 || r.status === 403 ? 'Jeton Vercel refusé (droits insuffisants).' : `Vercel a refusé le domaine (${msg || r.status}).`);
  }
}
export async function removeDomain(domain: string): Promise<void> {
  for (const name of domainsFor(domain)) await call('DELETE', `/v9/projects/${proj()}/domains/${encodeURIComponent(name)}`).catch(() => {});
}
export async function verifyDomain(domain: string): Promise<void> { await call('POST', `/v9/projects/${proj()}/domains/${encodeURIComponent(domain)}/verify`).catch(() => {}); }

export type DomainStatus = { domain: string; apex: boolean; added: boolean; verified: boolean; configured: boolean; verification: { type: string; domain: string; value: string }[]; dns: { type: string; name: string; value: string } };
export async function domainStatus(domain: string): Promise<DomainStatus> {
  const apex = isApex(domain);
  const dns = apex ? { type: 'A', name: '@', value: '76.76.21.21' } : { type: 'CNAME', name: domain.split('.')[0], value: 'cname.vercel-dns.com' };
  const p = await call('GET', `/v9/projects/${proj()}/domains/${encodeURIComponent(domain)}`);
  if (p.status === 404) return { domain, apex, added: false, verified: false, configured: false, verification: [], dns };
  const c = await call('GET', `/v6/domains/${encodeURIComponent(domain)}/config`);
  return { domain, apex, added: true, verified: !!p.json?.verified, configured: c.status === 200 && c.json?.misconfigured === false, verification: p.json?.verification ?? [], dns };
}
