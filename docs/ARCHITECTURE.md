# SENTABAKH LITE — Architecture (Phase A, pre-hackathon)

## Positionnement
Relier un paiement Bitcoin Lightning a une commande, suivre la livraison, declencher un versement en monnaie locale (XOF) apres confirmation.

## Flux cible (Phase B, hackathon)
1. Paiement Lightning (Bitnob `POST /api/lightning/invoices` → bolt11, verification confirmation)
2. Conversion BTC→USDT (`POST /api/trading/quotes` + `POST /api/trading/orders`)
3. Commande `funded`
4. Preuve livraison + confirmation destinataire
5. Cotation payout (`POST /api/payouts/quotes` from_asset=USDT to_currency=XOF country=SN)
6. Initialize + Finalize payout
7. Webhook `x-bitnob-signature` HMAC-SHA512 sur raw body

## Stack retenu
- Frontend React + TS + Vite (mobile-first)
- Backend Node Express + TS
- SQLite (WAL) pour demo/local
- Client Bitnob centralise avec HMAC-SHA256 (`x-auth-client/timestamp/nonce/signature` sur `CLIENT_ID:TIMESTAMP:NONCE:BODY`, body="" pour GET)
- Zod pour validation
- Vitest pour tests

## Base URL
`https://api.bitnob.com` (sandbox et prod meme host, environnement derive du secret signe — cf. llms.txt).

## Unites
- Trading `quantity` = string en unites majeures ("0.001" BTC, "100" USDT)
- Soldes/transactions/webhooks = base units (sats, 6-decimales USDT, kobo NGN)

## Etats (shared/src/index.ts)
`created → awaiting_payment → payment_confirmed → conversion_pending → funded → delivery_declared → delivery_confirmed → payout_pending → payout_processing → payout_completed` + `failed/expired/disputed`.

## Securite
- Cles uniquement cote serveur (`server/.env`), jamais exposees au frontend.
- Webhook verifie sur raw body + dedup.
- Pas de confiance aux payloads frontend pour statuts/references.

## Incoherences relevees (a verifier en live)
- `bitnob.dev` vs `docs.bitnob.co` : meme spec, host docs.bitnob.co parfois indisponible → utiliser `bitnob.dev` pour OpenAPI.
- Formats de reponse : melange RFC7807 vs `{success:false,error:{code,message,details}}` → gerer les deux.
