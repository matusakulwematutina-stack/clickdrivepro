# Intégration PawaPay (RDC) — ClickPro Drive

Même projet Supabase et même compte PawaPay que **Taxi des affaires**  
(`ngcjwhmjontbytzlzzlh`).

## Config de référence (Taxi)

| Variable | Valeur |
|----------|--------|
| `PAWAPAY_BASE_URL` | `https://api.pawapay.io` (production) |
| Callback dashboard | `…/functions/v1/pawapay-webhook` |
| Contrat dépôt wallet | `{ amount_cents, phone, operator }` |

Opérateurs : `airtel_money` · `mpesa` · `orange_money`  
→ providers API `AIRTEL_COD` / `VODACOM_MPESA_COD` / `ORANGE_COD`.

## Flux ClickPro

1. App → Edge Function `pawapay-deposit` (`amount_cents` + `operator`)
2. SQL Taxi `initiate_wallet_deposit` + ligne `wallet_topups` ClickPro
3. PawaPay PIN sur le téléphone
4. Webhook `pawapay-webhook` → `confirm_wallet_deposit`
5. Bridge SQL crédite aussi `profiles` / `drivers.wallet_balance` + `wallet_ledger`

## Déploiement

```powershell
# 1) Bridge solde ClickPro
$env:DATABASE_PASSWORD="…"
node supabase/apply-pawapay-bridge.mjs

# 2) Functions + secrets (lit le .env de Taxi si besoin)
.\scripts\deploy-pawapay.ps1 -SetSecrets
```

Ne pas pointer le dashboard PawaPay vers `pawapay-callback` : le callback
officiel est **`pawapay-webhook`** (déjà en place côté Taxi).

## Minimums CDF

| Opérateur | Min dépôt |
|-----------|-----------|
| Orange / Airtel | 100 FC |
| M-Pesa | 500 FC |
