# ClickPro Drive

Application de mobilité style Yango — **Expo (React Native)** + **Supabase**.  
Thème **noir / jaune**. Une seule base de code pour **Android (APK)** et **iPhone**.

## Démarrer

```bash
cd mobile
npm install
npx expo start
```

- Android : scanner le QR avec Expo Go, ou `a`
- iPhone : scanner le QR avec l’appareil photo / Expo Go

## Base de données

Le projet pointe déjà vers votre Supabase. Les tables existantes (`profiles`, `drivers`, `rides`, `vehicles`) ont été alignées via `supabase/migrate-align.sql`.

Si besoin de réappliquer :

```bash
DATABASE_PASSWORD=xxx node supabase/apply-migrate.mjs
```

Fichier local des clés : `mobile/.env` (ne pas committer).

## Déploiement Vercel (page web)

Le dossier `web/` sert une landing page statique (thème noir / jaune).

1. Connectez le dépôt GitHub sur [vercel.com/new](https://vercel.com/new)
2. **Framework Preset** : Other
3. **Build Command** : laisser vide
4. **Output Directory** : `web`
5. Déployer

En CLI (après `npx vercel login`) :

```bash
npx vercel --prod
```

## Build APK (Android)

```bash
cd mobile
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

Le profil `preview` dans `eas.json` génère un **APK** installable.

## Build iOS (iPhone)

Nécessite un compte Apple Developer :

```bash
cd mobile
eas build -p ios --profile preview
```

## Parcours MVP

**Client**
- Inscription / connexion
- Carte + destination
- Choix Taxi / Moto / Pickup
- Estimation prix (FC)
- Commande + suivi temps réel
- Note du chauffeur

**Chauffeur**
- Mode En ligne / Hors ligne
- Réception des demandes
- Acceptation
- Arrivé → Démarrer → Terminer

## Stack (légère)

| Couche | Techno |
|--------|--------|
| Mobile | Expo SDK 57 |
| Backend | Supabase (Auth, Postgres, Realtime) |
| Paiements | PawaPay API v2 (Orange / Airtel / M-Pesa COD) |
| Cartes | react-native-maps |
| GPS | expo-location |

## PawaPay (recharges)

Voir `docs/PAWAPAY.md`. Déployer les Edge Functions et le secret `PAWAPAY_API_TOKEN` pour activer les dépôts directs.
