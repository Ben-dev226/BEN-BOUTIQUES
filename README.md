# Boutiques SaaS — Next.js + Supabase + Vercel

Plateforme multi-boutiques (max **50 boutiques à vie**, verrouillé dans le code) : chaque boutique a son sous-domaine
`slug.ben-dev.com` (ou son propre domaine), son catalogue, son admin `/admin`, ses commandes WhatsApp, son logo et sa couleur.
Première boutique prête à importer : **FIFI QUALITY** (31 produits, dossier `seed/fifi`).

> ⚠ Licences : Vercel *Hobby* interdit l'usage commercial → gratuit pour construire/tester, **Vercel Pro (~20 $/mois)** dès que vous encaissez des clients.
> Supabase *Free* met la base en pause après 7 jours sans activité (la réveiller depuis le dashboard, ou passer Pro).

## 1. Supabase (base + images)
1. supabase.com → New project (région proche : Paris/Frankfurt). Notez le mot de passe de la base.
2. **Project Settings → Database → Connection string → « Transaction pooler »** (port 6543) → c'est `DATABASE_URL`.
3. **Storage → New bucket** nommé `uploads`, cocher **Public bucket**.
4. **Project Settings → API** : copiez `Project URL` (`SUPABASE_URL`) et la clé **service_role** (`SUPABASE_SERVICE_ROLE_KEY`, secrète, jamais dans le navigateur).

## 2. Mise en route locale (facultatif mais conseillé)
```bash
npm install
cp .env.example .env.local      # remplissez DATABASE_URL, AUTH_SECRET (openssl rand -base64 48), SUPABASE_*
npm run db:migrate              # crée les tables
npm run tenant:create -- --slug fifi --name "FIFI QUALITY" --whatsapp 22605847872
npm run import:v2 -- --slug fifi        # importe les 31 produits + images (seed/fifi)
npm run dev                     # http://localhost:3000  (DEFAULT_TENANT=fifi)
```
Sans `DATABASE_URL`, une base locale embarquée (PGlite, dossier `.data/`) est utilisée : pratique pour tester.
`tenant:create` affiche l'identifiant `admin` et un mot de passe temporaire (changement obligatoire à la 1re connexion).

## 3. Déploiement Vercel
1. Poussez ce dossier sur GitHub, puis Vercel → *Add New Project* → importez le dépôt (Next.js détecté).
2. *Environment Variables* : `DATABASE_URL`, `AUTH_SECRET`, `ROOT_DOMAIN=ben-dev.com`, `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET=uploads`, `PLATFORM_NAME`.
   Pour tester sur l'URL `*.vercel.app` ajoutez aussi `DEFAULT_TENANT=fifi`.
3. Déployez. Puis depuis votre PC (avec `.env.local` pointant vers Supabase) lancez `tenant:create` et `import:v2` si pas déjà fait.

## 4. Domaine ben-dev.com (sous-domaines automatiques)
Les sous-domaines génériques (`*.ben-dev.com`) exigent que **Vercel gère les DNS** :
1. Vercel → Project → Settings → Domains : ajoutez `ben-dev.com` **et** `*.ben-dev.com`.
2. Chez votre registrar, remplacez les *nameservers* par ceux indiqués par Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`).
3. Attendez la propagation (minutes à quelques heures) : `fifi.ben-dev.com` affiche la boutique, `ben-dev.com` une page neutre.

## 5. Panneau super-admin (gestion des boutiques)
```bash
npm run super:create -- --email vous@ben-dev.com --password UnMotDePasseSolide2026
```
Puis ouvrez **https://super.ben-dev.com** (en local : `/super`). Vous pouvez : créer une boutique (avec mot de passe admin temporaire),
suspendre/réactiver, régler l'offre, les limites (produits, utilisateurs), la **date d'abonnement payé** (boutons +1 mois / +3 mois / +1 an ;
date dépassée = boutique automatiquement indisponible, vide = jamais d'expiration), le domaine personnalisé, réinitialiser le mot de passe admin,
supprimer (saisie du slug). Le compteur « x / 50 » compte aussi les boutiques supprimées.
Équivalents en ligne de commande : `npm run tenant:create`, `npm run tenant:admin -- list | suspend | activate | set | reset-password`.
Domaine propre d'un client : saisi dans le panneau, ajouté dans Vercel → Domains, et le client crée un CNAME vers `cname.vercel-dns.com`.

## 6. Paiement des abonnements avec Chariow
Chaque boutique voit, dans **Admin → Paramètres → Abonnement**, sa date d'échéance et des boutons « Payer / prolonger » → page de paiement Chariow
(Mobile Money, carte) → à la confirmation, `paid_until` est prolongé **automatiquement** (à partir de l'échéance actuelle si elle est future, sinon d'aujourd'hui) et la boutique est réactivée.
1. Dans Chariow, créez vos produits d'abonnement (ex. « Abonnement 1 mois », « Abonnement 1 an ») et notez leur identifiant ou slug.
2. Chariow → *Settings → API Keys* : créez une clé avec le scope `checkout.write` → `CHARIOW_API_KEY`.
3. Chariow → *Automation → Pulses → Add Pulse* : URL `https://super.ben-dev.com/api/chariow`, événement `successful.sale`, produits d'abonnement. Copiez le secret `whsec_…` → `CHARIOW_PULSE_SECRET`.
4. Variables Vercel : `CHARIOW_PLANS=[{"id":"prd_xxx","months":1,"label":"1 mois"},{"id":"prd_yyy","months":12,"label":"1 an","plan":"pro"}]` (le champ `plan` est facultatif : il renomme l'offre de la boutique après paiement). Redéployez.
Sécurité : le webhook est vérifié (HMAC-SHA256 du corps brut, en-tête `x-chariow-signature`), un même paiement n'est jamais crédité deux fois, la durée vient de VOTRE configuration (jamais du client).
**Premier test réel (obligatoire avant de vendre)** : mettez `CHARIOW_DEBUG=1`, redéployez, faites une vente de petit montant sur une boutique de test, puis vérifiez
(1) les logs Vercel (`[chariow:debug]` : en-têtes et corps réels du Pulse), (2) Chariow → Pulses → historique (livraison 200), (3) la date `paid_until` de la boutique dans le panneau.
Si le Pulse n'envoie pas `custom_metadata`, le crédit se rattache automatiquement au dernier checkout en attente créé avec le même email + produit (3 jours). Retirez `CHARIOW_DEBUG` ensuite.
Points déjà gérés d'après l'expérience d'autres intégrations : événement `successful.sale` (le statut `awaiting_payment` n'est pas filtré), signature `x-chariow-signature` = `sha256=` + HMAC-SHA256 du corps brut avec le secret `whsec_…` complet,
téléphone séparé numéro + indicatif pays, `redirect_url` seulement si https, erreurs de l'API parsées quel que soit leur format, redéploiement nécessaire après toute modification des variables.
Les paiements apparaissent dans le panneau super-admin (fenêtre « Modifier »). Sans ces variables, le bouton est remplacé par « contactez-nous » et vous gérez la date à la main.

## 7. Domaines personnalisés automatiques (API Vercel)
Dans le panneau super-admin → Modifier → « Domaine personnalisé », saisissez `maboutique.com` : le domaine (et son `www.`) est **ajouté automatiquement au projet Vercel**,
et le panneau affiche l'état (« Domaine actif », « DNS à configurer », « Vérification requise ») avec les enregistrements exacts à communiquer au client
(domaine nu : `A @ → 76.76.21.21` + `CNAME www → cname.vercel-dns.com` ; sous-domaine : `CNAME sous → cname.vercel-dns.com`) et un bouton « Revérifier ».
Retirer le domaine ou supprimer la boutique le retire aussi de Vercel. Un domaine déjà utilisé par un autre projet Vercel est refusé.
Configuration : `VERCEL_API_TOKEN` (vercel.com/account/tokens), `VERCEL_PROJECT_ID` (nom ou id du projet), `VERCEL_TEAM_ID` (si projet d'équipe). Sans ces variables, ajoutez le domaine à la main dans Vercel → Domains.
Le certificat HTTPS est émis par Vercel une fois le DNS correct. Pensez à garder `ben-dev.com` / `*.ben-dev.com` sur ce même projet.

## 8. Surveillance, logs et sécurité
- **Panneau super-admin → 🛡️ Surveillance** : état du système (base, stockage, secrets, Chariow, mode debug), erreurs / alertes sécurité / avertissements des dernières 24 h,
  IP aux échecs de connexion répétés, et journal filtrable (niveau, type). Une pastille 🔴 signale les erreurs et alertes récentes. Conservation 90 jours (`EVENT_RETENTION_DAYS`).
- **Ce qui est enregistré** : erreurs serveur (avec trace, sans secrets), échecs et blocages de connexion (boutiques et super-admin), requêtes bloquées (trop de requêtes, jeton CSRF invalide),
  accès admin sans session, refus de quota, webhooks Chariow à signature invalide, paiements crédités / non rattachés, toutes les actions du super-admin (création, modification, suppression, mot de passe).
  En plus, chaque boutique garde son propre journal d'actions (Admin → Journal). Tout est aussi écrit en JSON dans les logs Vercel.
- **Alertes Telegram** : sur Telegram, parlez à **@BotFather** → `/newbot` → copiez le jeton (`TELEGRAM_BOT_TOKEN`). Ouvrez une discussion avec votre bot et envoyez-lui « salut », puis visitez
  `https://api.telegram.org/bot<JETON>/getUpdates` : repérez `"chat":{"id":123456789` → `TELEGRAM_CHAT_ID` (pour un groupe, ajoutez le bot au groupe ; l'identifiant est négatif). Redéployez, puis utilisez le bouton **📣 Tester les alertes** du panneau Surveillance.
  Gardez le jeton secret (quiconque l'a peut écrire en votre nom).
- **Autres canaux** (en plus ou à la place) : `ALERT_WEBHOOK_URL` (webhook Slack/Discord, ou https://ntfy.sh/votre-sujet) → message immédiat pour chaque erreur ou alerte sécurité (anti-spam : 1 par type / 10 min).
- **Disponibilité** : `https://ben-dev.com/api/health` (200 si la base répond, 503 sinon, aucun détail sensible) → à brancher sur UptimeRobot ou BetterStack (gratuit) pour être prévenu si le site tombe.
- **En-têtes** : HSTS, nosniff, Permissions-Policy, anti-iframe sur admin et super-admin ; cookies HttpOnly + SameSite=Strict ; CSRF ; limitation des tentatives ; mots de passe bcrypt.
- À faire côté hébergeur : activer l'authentification à deux facteurs sur Vercel, Supabase, GitHub et Chariow, et ne jamais mettre les clés dans le code.

## 9. Sauvegardes (Telegram + Google Drive) et quota de 500 Mo

**Ce qui se passe chaque nuit à 03:00 UTC** (Vercel Cron, `vercel.json`) : 1) copie complète de la base (toutes les boutiques) → compressée → **chiffrée AES-256** → envoyée sur votre canal Telegram et sur Google Drive ; 2) nettoyage de la base. Un échec déclenche une alerte Telegram. Onglet **💾 Sauvegardes** du super-admin : état, espace utilisé, historique, boutons « Sauvegarder maintenant », « Aperçu du nettoyage » et « Libérer de l’espace ».

**Réglages (Vercel → Environment Variables)**
1. `BACKUP_PASSPHRASE` : une longue phrase secrète. **Conservez-la hors de Vercel** (gestionnaire de mots de passe) : sans elle, impossible de relire une sauvegarde. Sans elle, l’envoi vers Telegram/Drive est refusé.
2. `CRON_SECRET` : 16+ caractères aléatoires (Vercel l’envoie tout seul à la tâche).
3. **Telegram** : créez un canal privé, ajoutez votre bot (celui des alertes) comme **administrateur**, puis `BACKUP_TELEGRAM_CHAT_ID` = l’identifiant du canal (`-100…`). Limite de 50 Mo par fichier : les fichiers plus gros sont découpés en `.part001`, `.part002`… (les recoller avec `cat`). Telegram ne permet pas d’effacer les anciens envois : le canal garde tout (c’est aussi un historique).
4. **Google Drive** : Google Cloud Console → nouveau projet → activer « Google Drive API » → écran de consentement OAuth (type Externe) → **Publier l’application (« En production »)**, sinon le jeton expire au bout de 7 jours → Identifiants → ID client OAuth « Application Web » avec l’URI de redirection `https://developers.google.com/oauthplayground`. Puis dans https://developers.google.com/oauthplayground : roue dentée → « Use your own OAuth credentials » → collez ID et secret → scope `https://www.googleapis.com/auth/drive.file` → Authorize → Exchange → copiez le **Refresh token**. Renseignez `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Le dossier « Sauvegardes … » est créé automatiquement ; les `BACKUP_KEEP` (30) dernières copies sont gardées.
5. Plan Vercel Hobby : une tâche par jour maximum et durée limitée ; si une sauvegarde devient lourde (> ~100 Mo), passez à Pro ou lancez `npm run backup` depuis votre PC.

**Quota de la base (Supabase gratuit : 500 Mo)** — `DB_QUOTA_MB`, `DB_WARN_PCT` (70), `DB_CRIT_PCT` (85) :
- toujours : suppression des données jetables (limiteurs, paiements en attente périmés, événements de plus de 90 j) ;
- ≥ 70 % : alerte Telegram, purge du journal d’événements (> 14 j) et d’audit (> 90 j), puis **compactage** des commandes terminées de plus de 180 j (`ORDERS_ARCHIVE_AFTER_DAYS`, minimum 90) : **on garde la commande** (numéro, date, client, montants, statut, paiement) **et un résumé des ventes par produit et par mois** (table `sales_archive`) ; on retire seulement le détail lourd (articles, historique, adresse, notes, IP). Le tableau de bord (7/30/90 j), les clients et le chiffre d’affaires ne changent pas. Dans l’admin, ces commandes affichent « détail archivé » et leur statut n’est plus modifiable.
- si la base reste ≥ 85 % malgré tout (dernier recours, rare) : suppression des commandes déjà compactées de plus de 2 ans (`ORDERS_DELETE_AFTER_DAYS`, 730), après avoir ajouté leurs **totaux mensuels** (nombre, annulées, chiffre d’affaires) à la table `orders_monthly`.
- **Garde-fou :** aucun détail n’est retiré sans une copie distante réussie de moins de 2 h (une sauvegarde est lancée juste avant ; si elle échoue, rien n’est touché et vous êtes alerté). Le détail complet reste dans les sauvegardes Drive/Telegram.
- Les images sont dans le Stockage Supabase (quota séparé de 1 Go), pas dans ces 500 Mo.

**Restaurer** (base vide ou nouvelle base, migrations appliquées automatiquement) :
```
npm run restore -- --file fq-backup-20261020-030000.ndjson.gz.enc --passphrase "votre phrase"
npm run restore -- --file … --passphrase "…" --wipe --yes     # remplace une base existante
```
Le script contrôle le nombre de lignes table par table et annule tout en cas d’écart. **Faites un test de restauration** sur un projet Supabase vide avant d’en avoir besoin. Autres commandes : `npm run backup` (sauvegarde + envoi), `npm run backup -- --clean` (puis nettoyage), `npm run backup -- --dry` (aperçu du nettoyage).

Non sauvegardé : les images (stockage Supabase), les variables d’environnement Vercel, et le journal d’événements (jetable, `BACKUP_INCLUDE_EVENTS=1` pour l’inclure).

## 10. Sécurité
Voir **SECURITY.md** (audit, corrections, risques résiduels). Points d’action : définir `AUTH_SECRET` (32+ caractères) ; activer la **2FA du super-admin** (bouton 🔐 2FA du panneau) ; mot de passe super-admin de 12+ caractères ; `SUPER_ALLOW_VERCEL_APP` vide une fois `super.<domaine>` en service.

## Architecture & sécurité
- Une base partagée, `tenant_id` sur chaque table et **chaque requête** ; la boutique vient du nom de domaine, jamais du client.
- Prix et stock recalculés côté serveur, décrément de stock conditionnel en transaction (pas de survente), codes promo plafonnés.
- Sessions JWT en cookie HttpOnly/SameSite=Strict + jeton CSRF, bcrypt, limitation des tentatives, mot de passe à changer à la 1re connexion.
- Images : validées (JPG/PNG/WebP), converties en WebP 1400 px + miniature, rangées par boutique.
- La vitrine est du HTML serveur sans hydratation React (`lib/jsx`), réutilisant le JS du panier/filtres/favoris ; PWA, sitemap, robots, JSON-LD par boutique.

## Pas encore fait (étapes suivantes)
Rappels d’expiration par email/WhatsApp, période de grâce, inscription en libre-service.

## 11. SEO

- **Plateforme** (`ben-dev.com`) : landing indexable, `robots.txt` + `sitemap.xml` dédiés, image de partage `public/landing/og.png`, JSON-LD Organization / WebSite / SoftwareApplication.
- **Boutiques** : `robots.txt` et `sitemap.xml` par boutique (produits avec images, pages catégories `/c/<slug>`), JSON-LD OnlineStore + WebSite (recherche) + Product + BreadcrumbList + CollectionPage, balises Open Graph/Twitter, canonical, `noindex` sur les URLs filtrées (`?q=…`), les aperçus et l'admin.
- **Réglages par boutique** (Admin → Réglages → Boutique) : titre Google, description Google, code Search Console.
- À faire côté vous : soumettre `https://ben-dev.com/sitemap.xml` et celui de chaque boutique dans Google Search Console.

## 12. Analytiques

- **Intégrés, sans cookie** : un navigateur est compté une fois par jour (marqueur local « date du jour »), seuls des compteurs agrégés sont stockés (table `stats_daily`, aucune IP, aucun identifiant). « Ne pas suivre » et les robots sont ignorés. Purge automatique après 2 ans.
- **Admin boutique → Audience** : visiteurs, pages vues, conversion, parcours (panier → commande), sources, produits les plus vus / ajoutés au panier, appareils, clics WhatsApp.
- **Super-admin → Audience** : visites de la landing (sources, appareils, clics WhatsApp) et visites par boutique sur 30 jours.
- **Google Analytics 4 / Pixel Meta** : chaque boutique saisit son ID (Paramètres → Boutique). Événements envoyés : page vue, ajout au panier, début de commande, achat. Prévoir une mention dans la politique de confidentialité de la boutique si elle les active.

### Insights automatiques
Un bloc « À savoir » (admin → Audience et Tableau de bord, super-admin → Audience) traduit les chiffres en constats et en actions : hausse/baisse de fréquentation, conversion faible ou bonne, abandon panier → commande, produit très vu mais jamais ajouté au panier, produit populaire en stock bas, part du mobile, absence de trafic Google, meilleur jour, produits sans photo ou description, description Google par défaut. Côté plateforme : conversion de la landing, boutiques sans visite, abonnements expirant sous 7 jours. Règles dans `lib/insights.ts` (seuils faciles à ajuster).
"# BEN-BOUTIQUES" 
