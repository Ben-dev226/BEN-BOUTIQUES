import { NextRequest } from 'next/server';
import { getShop } from '@/lib/shop';
import { platformIcon, shopIcon } from '@/lib/icons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Icône (onglet, écran d'accueil, partage) : celle de la boutique si l'adresse en désigne une, sinon celle de la plateforme. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const size = Math.max(16, Math.min(512, parseInt((await params).size, 10) || 192));
  const shop = await getShop();
  return shop ? shopIcon(shop, size, req.nextUrl.searchParams.get('m') === '1') : platformIcon(size);
}
