import { cleanHost } from './tenant';

/** Vrai pour la racine de la plateforme : la landing, indexable. Avec domaine : ben-dev.com / www. ; sans domaine : toute adresse sans boutique (*.vercel.app). */
export function isPlatformRoot(host: string): boolean {
  const root = (process.env.ROOT_DOMAIN || '').toLowerCase(), h = cleanHost(host);
  return root ? h === root || h === 'www.' + root : !!h;
}
export const platformOrigin = (host = '') => { const r = (process.env.ROOT_DOMAIN || '').toLowerCase(); return r ? `https://${r}` : host ? `https://${cleanHost(host)}` : ''; };
