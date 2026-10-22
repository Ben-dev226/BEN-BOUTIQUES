import { NextRequest } from 'next/server';
import { Ctx, ApiError, requireLogin, clientIp } from '@/lib/api/ctx';
import { hostFromHeaders, tenantForHost } from '@/lib/tenant';
import * as P from '@/lib/api/public';
import * as A from '@/lib/api/admin';
import * as O from '@/lib/api/orders';
import { logError, logSecurity, logWarn } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Level = null | 'user' | 'admin' | 'pending';
type H = (ctx: Ctx) => Promise<Response>;
const T: Record<string, Partial<Record<string, [Level, H]>>> = {
  'settings': { GET: [null, P.apiSettings] },
  'categories': { GET: [null, P.apiCategories] },
  'products': { GET: [null, P.apiProducts] },
  'product': { GET: [null, P.apiProduct] },
  'cart/refresh': { POST: [null, P.apiCartRefresh] },
  'promo/check': { POST: [null, P.apiPromoCheck] },
  'orders': { POST: [null, P.apiOrderCreate] },
  'orders/track': { GET: [null, P.apiOrderTrack] },
  'auth/login': { POST: [null, P.apiLogin] },
  'auth/logout': { POST: [null, P.apiLogout] },
  'auth/me': { GET: [null, P.apiMe] },
  'auth/password': { POST: ['pending', P.apiChangePassword] },
  'admin/insights': { GET: ['user', A.adminInsights] },
  'admin/analytics': { GET: ['user', A.adminAnalytics] },
  'admin/stats': { GET: ['user', A.adminStats] },
  'admin/products': { GET: ['user', A.adminProducts], POST: ['user', c => A.adminProductSave(c, false)] },
  'admin/product': { GET: ['user', A.adminProductGet], PUT: ['user', c => A.adminProductSave(c, true)], DELETE: ['user', A.adminProductDelete] },
  'admin/product/duplicate': { POST: ['user', A.adminProductDuplicate] },
  'admin/product/bulk': { POST: ['user', A.adminProductBulk] },
  'admin/product/stock': { POST: ['user', A.adminProductStock] },
  'admin/upload': { POST: ['user', A.adminUpload] },
  'admin/categories': { GET: ['user', A.adminCategories], POST: ['user', c => A.adminCategorySave(c, false)], PUT: ['user', c => A.adminCategorySave(c, true)], DELETE: ['user', A.adminCategoryDelete] },
  'admin/orders': { GET: ['user', O.adminOrders] },
  'admin/order': { GET: ['user', O.adminOrderGet], PUT: ['user', O.adminOrderUpdate], DELETE: ['admin', O.adminOrderDelete] },
  'admin/orders/export': { GET: ['user', O.adminOrdersExport] },
  'admin/customers': { GET: ['user', A.adminCustomers], PUT: ['user', A.adminCustomerUpdate] },
  'admin/customers/export': { GET: ['user', A.adminCustomersExport] },
  'admin/promos': { GET: ['user', A.adminPromos], POST: ['admin', c => A.adminPromoSave(c, false)], PUT: ['admin', c => A.adminPromoSave(c, true)], DELETE: ['admin', A.adminPromoDelete] },
  'admin/settings': { GET: ['admin', A.adminSettingsGet], POST: ['admin', A.adminSettingsSave], PUT: ['admin', A.adminSettingsSave] },
  'admin/users': { GET: ['admin', A.adminUsers], POST: ['admin', c => A.adminUserSave(c, false)], PUT: ['admin', c => A.adminUserSave(c, true)], DELETE: ['admin', A.adminUserDelete] },
  'admin/activity': { GET: ['admin', A.adminActivity] },
  'admin/billing': { GET: ['admin', A.adminBilling] },
  'admin/billing/checkout': { POST: ['admin', A.adminBillingCheckout] },
  'admin/backup': { GET: ['admin', A.adminBackup] },
};

async function handle(req: NextRequest): Promise<Response> {
  const json = (d: unknown, status: number) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' } });
  try {
    const tenant = await tenantForHost(hostFromHeaders(req.headers));
    if (!tenant) return json({ error: 'Boutique introuvable' }, 404);
    if (tenant.status !== 'active') return json({ error: 'Cette boutique est temporairement suspendue.' }, 503);
    const ctx = new Ctx(req, tenant);
    const route = (ctx.q('r') || '').replace(/^\/+|\/+$/g, '');
    const entry = T[route]; if (!entry) return json({ error: 'Route inconnue' }, 404);
    const h = entry[ctx.method]; if (!h) return json({ error: 'Méthode non autorisée' }, 405);
    const [level, fn] = h;
    if (level) await requireLogin(ctx, level === 'admin' ? 'admin' : undefined, level === 'pending');
    return await fn(ctx);
  } catch (e: any) {
    const ip = clientIp(req.headers), route = req.nextUrl.searchParams.get('r') || '';
    if (e instanceof ApiError) {
      if (e.status === 429) await logSecurity({ type: 'rate_limited', message: `${route} bloqué (trop de requêtes)`, ip, detail: { route } });
      else if (e.status === 403 && /sécurité/.test(e.message)) await logSecurity({ type: 'csrf_invalid', message: `Jeton CSRF invalide sur ${route}`, ip, detail: { route } });
      else if (e.status === 401 && route.startsWith('admin/')) await logWarn({ type: 'unauthorized', message: `Accès admin sans session : ${route}`, ip });
      else if (e.status === 402) await logWarn({ type: 'quota_refused', message: e.message, ip, detail: { route } });
      return json({ error: e.message, ...e.extra }, e.status);
    }
    await logError({ type: 'api_error', message: `${req.method} ${route} : ${(e as Error)?.message}`, ip, detail: e });
    return json({ error: 'Erreur serveur' }, 500);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
