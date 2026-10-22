import { cleanHost } from './tenant';

/** Vrai pour la racine de la plateforme (ben-dev.com / www.) : la landing, indexable. */
export function isPlatformRoot(host: string): boolean {
  const root = (process.env.ROOT_DOMAIN || '').toLowerCase(), h = cleanHost(host);
  return !!root && (h === root || h === 'www.' + root);
}
export const platformOrigin = () => { const r = (process.env.ROOT_DOMAIN || '').toLowerCase(); return r ? `https://${r}` : ''; };
