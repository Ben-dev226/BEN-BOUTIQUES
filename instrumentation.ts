/** Toute erreur serveur non gérée (page, route, rendu) est centralisée dans le journal de la plateforme. */
export async function onRequestError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routeType?: string; routePath?: string }) {
  try {
    const { logError } = await import('./lib/log');
    const e = err as Error & { digest?: string };
    const ip = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    await logError({ type: 'server_error', message: `${request.method} ${request.path.split('?')[0]} : ${e?.message || 'erreur'}`.slice(0, 280), ip, detail: { route: context?.routePath, kind: context?.routeType, digest: e?.digest, stack: e?.stack } });
  } catch { /* jamais bloquant */ }
}
