/** @type {import('next').NextConfig} */
// Politique de sécurité du contenu : pas d'objets/plugins, pas de <base> détourné, pas d'envoi de formulaire vers l'extérieur,
// pas d'intégration dans le site d'un tiers (clickjacking) et aucune requête de script vers un domaine tiers.
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:", "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", ...(process.env.VERCEL ? ["upgrade-insecure-requests"] : []),
].join('; ');

export default {
  serverExternalPackages: ['sharp', 'pg', '@electric-sql/pglite'],
  poweredByHeader: false,
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: '/api/index.php', destination: '/api/router' },   // compatibilité avec le JS existant
      { source: '/super', destination: '/super/index.html' },
      { source: '/admin', destination: '/admin/index.html' },
      { source: '/admin/', destination: '/admin/index.html' },
    ];
  },
  async headers() {
    return [
      { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Content-Security-Policy', value: CSP }, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' }] },
      { source: '/super/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'X-Frame-Options', value: 'DENY' }] },
    ];
  },
};
