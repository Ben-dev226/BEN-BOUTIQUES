import { getShop } from '@/lib/shop';
import { platformIcon, shopIcon } from '@/lib/icons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Les navigateurs demandent /favicon.ico d'office : on répond avec l'icône de la boutique ou de la plateforme (PNG). */
export async function GET() { const shop = await getShop(); return shop ? shopIcon(shop, 48) : platformIcon(48); }
