# Preparation pre-hackathon — SENTABAKH LITE

## Ordre d'execution Phase A (realise le 2026-10-15)
1. Verifier `node -v` (v24.22.0), `npm.cmd -v` (12.2.0), `git --version` (2.55.0), PATH reconstruit deduplique.
2. Etudier Bitnob : `llms.txt`, OpenAPI `/api-collections/swagger/bitnob-api-v2.openapi.json`, routes Lightning/Trading/Payouts/Webhooks.
3. Scaffolder le monorepo (workspaces npm) : shared, server, client + config TS.
4. Implementer : HMAC signer, client Bitnob, schema SQLite, endpoints health/preflight/webhook, tests sanity.
5. Verifier preflight sans credentials → mode demo explicite.

## Recherche technique (synthese)
- Auth : HMAC-SHA256 hex de `CLIENT_ID:TIMESTAMP:NONCE:BODY`, headers `x-auth-*`.
- Webhook : HMAC-SHA512 du raw body, header `x-bitnob-signature`.
- Lightning : `POST /api/lightning/invoices` (customer_id, amount sats, description, expiry, reference), `POST /api/lightning/pay`, `GET /api/lightning/invoices`.
- Trading : `POST /api/trading/quotes` (base/quote/side/quantity string), `POST /api/trading/orders` (+quote_id, reference, price?).
- Payouts : `POST /api/payouts/quotes` (from_asset, to_currency, source, amount base-units string, payment_reason, reference, country), `POST /api/payouts/{quoteId}/initialize` (beneficiary, reference, callback_url), `POST /api/payouts/{quoteId}/finalize`.

## Plan d'execution jour J (17 oct, hackathon)
1. `npm install` (racine → workspaces)
2. Renseigner `.env` (BITNOB_CLIENT_ID/SECRET si fournis le jour J)
3. `npm run preflight` (lecture seule)
4. Construire MVP complet (commandes, factures, conversion, preuves, payouts, dashboard, mode demo)
5. `npm test` + `npm run build` + demo 3 min

## Prerequis manquants (a l'instant)
- Aucun identifiant Bitnob sandbox configure → mode demo actif, parcours reel non teste.
- Aucun secret webhook → verification webhook en mode permissif (log warning).
- Pas de donnee metier initiale (repertoire vide au depart, volontaire).

## Commandes
```
npm install
npm run preflight --workspace=server
npm run dev          # client :5173 + server :4000
npm test             # server + shared
npm run build
```
