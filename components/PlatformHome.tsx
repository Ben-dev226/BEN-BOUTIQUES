import { headers } from 'next/headers';
import { tenantFromHeaders, hostFromHeaders, baseFromHeaders } from '@/lib/tenant';
import { htmlPage } from '@/lib/html';
import { one } from '@/lib/db';
import { landingPage } from './Landing';

/** Boutique inconnue (racine de la plateforme, adresse erronée) ou suspendue. */
export async function platformPage(status = 404) {
  const hs = await headers(), host = hostFromHeaders(hs), root = (process.env.ROOT_DOMAIN || '').toLowerCase();
  const t = await tenantFromHeaders(hs).catch(() => null);
  if (!t && !baseFromHeaders(hs) && (!root || host === root || host === 'www.' + root)) return landingPage(host);
  const suspended = t?.status === 'suspended';
  let empty = false; try { empty = !t && !(await one('SELECT 1 FROM tenants LIMIT 1')); } catch { /* base injoignable */ }
  return htmlPage(null, { title: suspended ? 'Boutique indisponible' : process.env.PLATFORM_NAME || 'Boutiques en ligne' },
    <main style={{ font: '16px/1.6 system-ui, sans-serif', maxWidth: 560, margin: '18vh auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.8rem' }}>{suspended ? 'Boutique temporairement indisponible' : (process.env.PLATFORM_NAME || 'Boutiques en ligne')}</h1>
      <p style={{ color: '#555' }}>{suspended ? 'Cette boutique est momentanément suspendue. Merci de revenir plus tard.' : empty ? 'La plateforme est installée mais aucune boutique n\'existe encore. Si vous êtes le propriétaire, ouvrez /setup pour terminer la configuration.' : 'Cette adresse ne correspond à aucune boutique. Vérifiez le lien reçu ou contactez votre vendeur.'}</p>
    </main>, suspended ? 503 : status);
}
