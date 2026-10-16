# SENTABAKH LITE — Code & Chain Dakar 2026

> Paiement Bitcoin Lightning → commande commerciale → preuve de livraison → versement en monnaie locale (XOF). Intègre Bitnob (Lightning, Trading, Payouts).

**Événement :** Code & Chain Dakar 2026, 17–18 octobre 2026.  
**Statut au 16 octobre 2026 :** Prototype complet opérationnel en local. Phase A (veille) + prototype hackathon réalisés. Mode **DEMO** par défaut (aucun fonds réel) ; mode **sandbox réel** activable si `BITNOB_CLIENT_ID/SECRET` fournis jour J.

## Fonctionnalités opérationnelles

**Parcours complet (DEMO) :**
1. Création commande (montant sats, description, vendeur, bénéficiaire, mode demo/sandbox)
2. Génération facture Lightning — DEMO `lnbc...DEMO_NO_FUNDS` clairement marquée, ou réelle via `POST /api/lightning/invoices` si Bitnob configuré
3. Confirmation paiement — simulation DEMO ou vérification réelle `GET /api/lightning/invoices/:id`
4. Preuve de livraison + confirmation réception (transitions gardées)
5. Cotation payout XOF (estimation DEMO ou `POST /api/payouts/quotes` réel)
6. Initialisation versement + finalisation (DEMO ou `POST /api/payouts/:quoteId/initialize|finalize`)
7. Historique complet (transitions, factures, cotations, versements, preuves) persistant après redémarrage

**Sécurité & robustesse :**
- Auth Bitnob HMAC-SHA256 (`CLIENT_ID:TIMESTAMP:NONCE:BODY`, body="" pour GET, hex), webhook HMAC-SHA512 sur raw body + dedup `UNIQUE(dedup_key)` + rejet 401 si secret configuré et signature invalide
- Machine à états 13 statuts (`created → ... → payout_completed|failed|expired|disputed`), garde `canTransition` côté serveur uniquement
- Anti double facture / double cotation / double payout (409), Zod validation, unités sats↔BTC

**Interface :** React + Vite, 100% français, responsive, badge `DÉMONSTRATION — AUCUN FONDS RÉEL` / `SANDBOX` en haut, pages `/` (liste), `/new` (création), `/orders/:id` (détail + actions), `/health` (preflight). Tous les boutons font une vraie requête ou sont désactivés avec raison.

**Tests :** 21 tests (sanity 9 + extended 12) : transitions interdites, sats/BTC, Zod, HMAC SHA256/SHA512, webhook invalide/répété, persistance, demo vs réel, secrets hors frontend.

## Architecture

- **Frontend** `client/` : React 18 + TypeScript + Vite 6 + React Router, `VITE_API_URL`, `VITE_APP_MODE`
- **Backend** `server/` : Express + Helmet/CORS/Morgan + `node:sqlite` (natif Node 24, WAL) + Zod + `tsx`
- **Shared** `shared/` : états, schemas, utilitaires (`satsToBtc`, `canTransition`)
- **Bitnob** `server/src/bitnob/` : `signer.ts` (HMAC), `client.ts` (fetch centralisé, sanitize logs, erreurs RFC7807)
- **DB** `server/src/db/` : `schema.ts` (8 tables + 3 index), `helpers.ts` (transitions, `getOrderFull`), `node:sqlite`
- **Routes** `server/src/routes/` : `orders.ts` (CRUD + invoice + demo + proof + payout), `bitnob.ts` (balances, countries, prices — lecture seule)
- Base Bitnob : `https://api.bitnob.com` (même host sandbox/prod, secret détermine l'env)

## Prérequis

Node >=20 (testé v24.22.0), npm 12.2.0 (`npm.cmd` sous PowerShell), Git 2.55.0.

## Installation

```powershell
# reconstruire le PATH si Git non reconnu (mécanisme validé)
$machinePath=[Environment]::GetEnvironmentVariable("Path","Machine"); $userPath=[Environment]::GetEnvironmentVariable("Path","User"); $entries=@($machinePath -split ';')+@($userPath -split ';')+@($env:Path -split ';'); $seen=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase); $env:Path=(($entries|ForEach-Object{$e=$_.Trim();if($e -and $seen.Add($e)){$e}})-join ';')

npm.cmd install
# optionnel : copier .env.example -> .env et renseigner BITNOB_* si fournis
Copy-Item .env.example .env
# éditer .env : BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET, BITNOB_WEBHOOK_SECRET, BITNOB_CUSTOMER_ID
```

## Configuration (.env)

Voir `.env.example`. Clés Bitnob **uniquement côté serveur** (`BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET`, `BITNOB_WEBHOOK_SECRET`, `BITNOB_CUSTOMER_ID`). Frontend : `VITE_API_URL=http://localhost:4000`, `VITE_APP_MODE=sandbox|demo`. `APP_MODE=sandbox` par défaut. Jamais de secret dans `client/`.

## Commandes

```powershell
npm.cmd run preflight --workspace=server  # sans fonds : whoami/balances/countries/prices si creds, sinon message demo
npm.cmd run dev --workspace=server        # backend :4000 (tsx watch)
npm.cmd run dev --workspace=client        # frontend :5173 (vite)
npm.cmd run dev                           # les deux (concurrently)
npm.cmd test                              # server (43) + shared (--passWithNoTests)
npm.cmd run lint                          # ESLint réel (plus de fallback)
npm.cmd run build --workspace=shared      # tsc shared
npm.cmd run build --workspace=server      # tsc server
npm.cmd run build --workspace=client      # tsc --noEmit + vite build (front dist)
npm.cmd run build                         # tout
```

## Tests & build (résultats réels 16 oct — vérifiés)

- `npm test` : **43 passed** (sanity 9 + extended 34 — transitions, HMAC, webhook dedup, DEMO/SANDBOX, secrets hors frontend)
- `npm run lint` : **0 erreur** (ESLint 9 + typescript-eslint 8, config `eslint.config.js`)
- `tsc --noEmit` server/client/shared : **0 erreur** (client build corrigé `tsc --noEmit && vite build` — plus de `.js` parasites)
- `vite build` client : **31 modules, 212.33 kB (gz 65.42 kB), CSS 12.25 kB (gz 3.17 kB)**
- `npm run preflight --workspace=server` : **OK offline** (`configured:false` sans creds, sinon checks lecture seule sans fonds)

## Modes démonstration et sandbox

- **DEMO** (par défaut sans `BITNOB_*`) : toutes les opérations financières sont simulées, bolt11 `...DEMO_NO_FUNDS`, statuts `*_demo`, bandeau orange, montants estimés clairement étiquetés. Aucun appel Bitnob sortant.
- **Sandbox réel** (`BITNOB_*` renseignés + `APP_MODE=sandbox`) : `POST /api/lightning/invoices`, `GET /api/lightning/invoices/:id`, `POST /api/payouts/quotes`, `POST /api/payouts/:quoteId/initialize|finalize` réellement appelés avec HMAC. Les écritures échouent proprement (502) si quota/corridor indisponible, sans masquer l'erreur.
- Toute facture/confirmation/cotation/versement simulé reste identifiable en DB (`demo` flag), historique et logs.

## Procédure de validation Bitnob

Sans creds : `npm.cmd run preflight --workspace=server` affiche `Bitnob configured: false → Mode DEMO autorisé`.  
Avec creds sandbox : le même preflight teste `GET /api/whoami`, `/api/balances`, `/api/payouts/supported-countries`, `/api/trading/prices` — **lecture seule, aucun mouvement de fonds**. Les résultats sont loggés sans secrets (headers sanitizés). Les webhooks `POST /api/webhooks/bitnob` sont vérifiables avec `x-bitnob-signature`.

Sources : https://bitnob.dev — https://bitnob.dev/llms.txt — https://bitnob.dev/api-reference/lightning|trading|payouts — OpenAPI https://bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json

## Limitations réelles (16 oct — vérifiées)

- Aucun `BITNOB_CLIENT_ID/SECRET` fourni → parcours réel non vérifié en live (DEMO testé bout en bout, 10 transitions `created→payout_completed`). Trading sandbox non éprouvé faute de paire testable ; le serveur expose désormais `POST /api/orders/:id/trading/quote|execute` + `GET .../trading/status` conformes OpenAPI (BTC→USDT SELL), avec garde `demo:403`, expiration et anti-double.
- `BITNOB_CUSTOMER_ID` requis pour `POST /api/lightning/invoices` (`/api/orders/:id/check-payment` vérifie aussi `expires_at` et refuse les factures expirées 410)
- Pas de déploiement distant — **production locale prête** : `npm run build` → `client/dist` servi par `server/src/index.ts` (`express.static` + SPA fallback, `GET /` → index.html, `GET /health` et `/api/*` intacts). Vérifié `curl http://localhost:4000/` 200 + `/health` JSON. `.env`/`*.db`/`uploads` jamais servis.
- Lint était un fallback `|| echo ...` → remplacé par **ESLint 9 réel** (`eslint.config.js`, `npm run lint` 0). Stray `client/src/**/*.js` corrigé (`.gitignore` + `client build: tsc --noEmit && vite build`).

## Sécurité

- Secrets jamais exposés au frontend (test `Secrets jamais dans frontend` 2 tests verts), jamais committés, `.env` ignoré, `git ls-files` ne liste aucun `.env`/`.db`
- Webhook : `rawBody` conservé via `express.json({verify: rawBodySaver})`, HMAC-SHA512 constant-time (timing-safe), dedup `UNIQUE(dedup_key)`, 401 si secret configuré et signature fausse, warning si sans secret
- `.gitignore` : `node_modules/`, `.env`, `data/`, `*.db`, `dist/`, `logs/`, `uploads/`, `preflight-report.json`, `client/src/**/*.js`
- Anti-rejeu : serveur garde `409` facture/cotation/payout déjà existante, `403` trading en DEMO, `400` check-payment sur facture demo, `410` invoice/quote expirée ; `GET .../trading/status` et `GET .../payout/status` à consulter avant retry
- `helmet` + `cors` configurés ; aucun log n'imprime de clé (headers sanitizés `sanitizeHeaders`)

## Déploiement

Prévu Vercel (frontend) + Render/Fly (backend) ou Docker. `server/dist` (tsc) + `client/dist` (vite) prêts. Non prétendu déployé avant vérification URL.

## Scénario de démonstration (3 min, hors ligne possible)

1. **Créer** : `/new` → 50000 sats, "Riz 25kg", demo coché → Créer
2. **Payer** : Générer facture → bolt11 DEMO affiché → Simuler paiement confirmé
3. **Livrer** : Déposer preuve → Confirmer réception
4. **Verser** : Cotation XOF (30M XOF estimé DEMO) → Init versement (WAVE, 771234567) → Simuler versement terminé
5. **Historique** : 10 transitions `created → payout_completed`, payouts `completed_demo`, tout marqué DEMO

Commandes API équivalentes (PowerShell) : voir `docs/PREPARATION.md` ou rejouer le parcours via `Invoke-RestMethod` sur `http://localhost:4000`.

## Licence

Privé — Code & Chain Dakar 2026.
