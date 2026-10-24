# Audit de sécurité — plateforme boutiques

Périmètre : tout le code (auth, isolation entre boutiques, API, uploads, paiement, sauvegardes, en-têtes, dépendances). Méthode : relecture complète du code + tests d'attaque automatisés (`sec_test`, 34 contrôles) + `npm audit`. Corrections appliquées dans cette version.

## Failles trouvées et corrigées
| # | Gravité | Problème | Correction |
|---|---|---|---|
| 1 | Élevée | Super-admin : si `AUTH_SECRET` manquait en production, la session était signée avec une clé par défaut connue (falsifiable). | Plus aucune clé par défaut en production ; `AUTH_SECRET` ≥ 32 caractères exigé (sinon erreur). |
| 2 | Élevée | Fusion de produits : un identifiant d'une AUTRE boutique était accepté (écriture inter-boutiques). | Tous les produits doivent appartenir à la boutique (404 sinon). |
| 3 | Élevée | Suivi de commande : sans téléphone, n'importe quel numéro de commande renvoyait articles, total et statut. | Téléphone obligatoire, ou clé secrète (HMAC) intégrée au lien WhatsApp. |
| 4 | Moyenne | Liens réseaux sociaux non filtrés (`javascript:` → XSS pour les visiteurs). | Seules les URL http(s) sont acceptées (à l'enregistrement et à l'affichage). |
| 5 | Moyenne | Sessions non révocables : un changement de mot de passe laissait les anciennes sessions valides 8 h. | Empreinte du mot de passe dans le jeton : toute autre session est invalidée. |
| 6 | Moyenne | Super-admin sans double authentification. | TOTP (Google Authenticator, Authy…) avec anti-rejeu, activable dans le panneau (2FA). Récupération : `npm run super:create -- … --reset-2fa`. |
| 7 | Moyenne | Panneau super-admin accessible sur `*.vercel.app`. | Servi uniquement sur `super.<domaine>` (sauf `SUPER_ALLOW_VERCEL_APP=1`). |
| 8 | Moyenne | Verrouillage de connexion par compte : un tiers pouvait bloquer l'administrateur. | Verrou par (compte + IP) + plafond global plus large : l'attaquant est bloqué, pas le propriétaire. |
| 9 | Faible | Aucune CSP ni protection anti-clickjacking sur la vitrine. | CSP (pas d'objets, `base-uri`, `form-action`, `frame-ancestors`), `X-Frame-Options`. |
| 10 | Faible | Logo : pas de limite de pixels au décodage (bombe de décompression). | Limite 40 Mpx. |
| 11 | Faible | Un client pouvait écraser le nom d'une fiche client existante via une commande. | La fiche existante n'est plus réécrite. |
| 12 | Faible | bcrypt coût 10 ; temps de réponse différent si l'identifiant n'existe pas. | Coût 12, hash factice de même coût ; mot de passe super-admin ≥ 12 caractères. |
| 13 | Faible | IP lue sur `X-Forwarded-For` en premier. | En-têtes de la plateforme d'abord (`x-vercel-forwarded-for`, `x-real-ip`). |

## Vérifié sans problème
Injection SQL (requêtes paramétrées partout) · XSS (échappement systématique, JSON inline neutralisé) · CSRF (jeton + SameSite=Strict) · cookies HttpOnly/Secure · isolation par `tenant_id` sur toutes les routes admin · prix et stock relus en base · upload (contenu réel vérifié, ré-encodé en WebP, SVG refusé) · injection de formule CSV · webhook Chariow (HMAC en temps constant, idempotent) · cron (secret en temps constant) · secrets masqués dans les journaux · sauvegardes chiffrées AES-256-GCM.

## Risques résiduels (à connaître)
- `npm audit` : 1 alerte `postcss` (embarqué par Next.js, utilisé seulement au build, aucun CSS externe traité). À corriger avec la prochaine version de Next.
- CSP avec `unsafe-inline` (scripts en ligne existants) : limite l'effet d'une XSS sans l'empêcher ; à durcir par des nonces si besoin.
- Pas de 2FA pour les administrateurs de boutique (seulement le super-admin).
- Les sessions durent 8 h et ne se révoquent qu'au changement de mot de passe (pas de « déconnexion partout » à la demande).
- Hors Vercel, `X-Real-IP`/`X-Forwarded-For` sont falsifiables : placez l'app derrière un proxy qui les réécrit.
- `CHARIOW_DEBUG=1` journalise des e-mails clients : à retirer après les tests.

## Votre part (hors code)
Activer la 2FA sur Vercel, Supabase, Google, GitHub, Chariow et Telegram · un mot de passe unique long pour le super-admin + 2FA du panneau · `BACKUP_PASSPHRASE` conservée hors Vercel · tester une restauration · alertes Telegram actives · UptimeRobot sur `/api/health`.
