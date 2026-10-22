import type { NextRequest } from 'next/server';
import Shell from '@/components/Shell';
import { platformPage } from '@/components/PlatformHome';
import { htmlPage } from '@/lib/html';
import { getShop } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const shop = await getShop(); if (!shop) return platformPage();
  return htmlPage(shop, { title: 'Suivre ma commande', noindex: true, canonical: '/suivi' }, (
    <Shell shop={shop} nav="suivi" scripts={['suivi.js']}>
      <section className="page narrow">
        <h1>Suivre ma commande</h1>
        <p className="muted">Saisissez le numéro reçu après votre commande (ex. {shop.s.order_prefix}-261015-AB12).</p>
        <form className="form" id="trackForm">
          <label>Numéro de commande<input id="tNum" required autoComplete="off" autoCapitalize="characters" defaultValue={req.nextUrl.searchParams.get('n') ?? ''} /></label>
          <label>Téléphone utilisé pour commander<input id="tPhone" type="tel" inputMode="tel" autoComplete="tel" placeholder="ex. 70 12 34 56" /></label>
          <button className="btn btn-red" type="submit">Rechercher</button>
        </form>
        <div id="trackResult" aria-live="polite" />
      </section>
    </Shell>
  ));
}
