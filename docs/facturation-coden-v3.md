# Facturation Coden v3 — spécification, schéma et architecture

Statut : **proposition à valider avant tout code.** Ce document décrit le système demandé, le schéma de base de données et l'architecture. Il signale aussi les points où les tarifs par défaut posent un problème de rentabilité. Rien n'est encore implémenté.

Point de départ : Coden a déjà une facturation v2 en production, ce qui existe est réutilisé plutôt que dupliqué :
- comptes de facturation ;
- grants de crédits consommés dans l'ordre (grant spécifique d'abord, puis crédits généraux par date d'expiration) ;
- registre des mouvements ;
- réservation, règlement et libération ;
- recharge automatique ;
- paiement Saspay en FCFA.

Chaque table ci-dessous porte la mention **existe**, **modifiée** ou **nouvelle**.

---

## 1. Modèle de crédits

Un solde unique par workspace (= `organizations` + `billing_accounts`), consommé par cinq catégories d'usage :

| Catégorie | Code | Ce qui est facturé |
|---|---|---|
| Build | `build` | Messages de l'agent qui modifient le projet, au coût réel : tokens d'entrée, de sortie et de raisonnement, modèle, sous-agents. |
| Chat | `chat` | Messages sans modification de code, à une fraction de crédit. |
| Cloud | `cloud` | Hébergement et backend Coden Cloud des apps déployées. |
| IA des apps | `app_ai` | Appels aux modèles d'IA faits par les apps déployées. |
| Connecteurs | `connectors` | Requêtes via les connecteurs gérés par Coden (Composio, scraping…). |

Aucun tarif n'est codé en dur. Prix du crédit, plans, grants, coûts unitaires, marges, seuils et taux de change sont lus dans la configuration versionnée (§ 10.1), modifiable depuis le panel admin sans redéploiement.

## 2. Calcul du coût réel

### Build et Chat

```
coût_fournisseur_usd = Σ appels OpenRouter du message
                       (agent principal + chaque sous-agent + planificateur + critique visuelle)
                       coût renvoyé par OpenRouter (tokens entrée + sortie + raisonnement au tarif du modèle)
coût_complet_usd     = coût_fournisseur_usd × (1 + frais_achat_openrouter)   # 5,5 % aujourd'hui
crédits              = max(minimum_catégorie, coût_complet_usd / coût_réel_max_par_crédit)
coût_réel_max_par_crédit = prix_de_référence_du_crédit × ratio_coût_max       # ratio 0,40 par défaut
```

- Arrondi au centième de crédit supérieur. Minimums configurables : 0,05 crédit pour le Chat, 0,1 pour le Build.
- Modèles premium et raisonnement élevé ou maximum : toujours facturés au coût réel des tokens, jamais au forfait.
- Mode Auto avec sous-agents : somme du coût réel de chaque sous-agent. Les sous-agents sont déjà mesurés un par un dans le pipeline.

### Cloud

Métriques collectées en continu pour chaque projet, agrégées par heure, puis déduites en fin d'heure (§ 10.4) :
- instance de base de données : taille × durée active ;
- stockage de la base (Go) ;
- réseau (Go transférés) ;
- stockage de fichiers (Go) ;
- fonctions : invocations et durée ;
- Realtime : messages envoyés.

## 3. Plans et grants

- Plans : Gratuit, Pro, Pro+, Business, Enterprise. Prix et quantités sont configurables.
- **Grants spécifiques**, consommés AVANT les crédits généraux :
  - crédits de build quotidiens (plafond mensuel pour le plan Gratuit) ;
  - grant Cloud mensuel ;
  - grant IA des apps mensuel.
- **Crédits généraux** :
  - crédits mensuels du plan, reportés d'un mois sur l'autre avec une date d'expiration ;
  - recharges, valables 12 mois ;
  - bonus (parrainage, promotions, gestes commerciaux).
- **Ordre de consommation** : grants spécifiques de la catégorie d'abord, puis crédits généraux les plus proches de l'expiration. À échéance égale : bonus, puis plan, puis recharge, pour préserver ce que l'utilisateur a payé.

## 3 bis. Tarifs initiaux (valeurs par défaut de la table de configuration)

Toutes ces valeurs sont des valeurs de départ, stockées en base et modifiables depuis le panel admin sans redéploiement.

**Affichage des prix** : dollars en valeur principale, FCFA en exposant, par exemple 20 $<sup>12 000 FCFA</sup>.
- Le taux de conversion (défaut 600 FCFA pour 1 $, valeur actuelle de la v2) fait partie de la configuration.
- Arrondi à 100 FCFA pour les prix affichés ; valeur exacte dans les factures et le registre.

### Plans

| Plan       | Prix mensuel | Prix annuel (par mois) | Crédits mensuels         | Prix recharge  |
|------------|--------------|------------------------|--------------------------|----------------|
| Gratuit    | 0 $<sup>0 FCFA</sup> | —              | 5/jour, une fois         | Non disponible |
| Pro        | 20 $<sup>12 000 FCFA</sup> | 16 $<sup>9 600 FCFA</sup> | 100      | 0,25 $<sup>150 FCFA</sup>/crédit |
| Pro+       | 45 $<sup>27 000 FCFA</sup> | 36 $<sup>21 600 FCFA</sup> | 250      | 0,22 $<sup>132 FCFA</sup>/crédit |
| Business   | 40 $<sup>24 000 FCFA</sup> | 32 $<sup>19 200 FCFA</sup> | 100 + fonctions équipe | 0,45 $<sup>270 FCFA</sup>/crédit |
| Enterprise | Sur devis    | —                      | Sur mesure               | Sur mesure     |

- Les plans payants reçoivent en plus 5 crédits de build quotidiens, sans plafond mensuel.
- Recharges disponibles par paliers : 50, 100, 250, 500, 1000 crédits.

### Grants mensuels (tous les plans)

- Cloud : 20 crédits/mois.
- IA des apps déployées : 5 crédits/mois.
- Non reportables d'un mois sur l'autre.

### Coûts indicatifs Build et Chat

Le coût réel est toujours calculé à partir des tokens OpenRouter consommés × marge. Ces valeurs servent de repères pour l'affichage et les tests :

| Action                                   | Crédits    |
|------------------------------------------|------------|
| Petite modification (couleur, texte)     | 0,3 à 0,5  |
| Fonctionnalité moyenne (auth, formulaire)| 1 à 2      |
| Page complète avec images                | 2 à 3      |
| Message de chat sans code                | 0,05 à 0,2 |

- Modèles premium et raisonnement élevé ou maximum : toujours facturés au coût réel des tokens avec la marge, jamais au forfait.
- Mode Auto avec sous-agents : coût total = somme du coût réel de chaque sous-agent.

### Coûts Cloud

| Ressource                                    | Crédits |
|----------------------------------------------|---------|
| Instance base de données petite (par mois)   | 10      |
| Instance moyenne (par mois)                  | 30      |
| Instance grande (par mois)                   | 80      |
| Stockage base de données (par Go/mois)       | 1       |
| Stockage fichiers (par Go/mois)              | 0,5     |
| Réseau (par Go transféré)                    | 0,5     |
| Fonctions (par 100 000 invocations)          | 1       |
| Realtime (par 1 million de messages)         | 1       |

### Règle de rentabilité

- Marge par défaut : le coût réel d'un crédit (OpenRouter + infrastructure) doit rester sous 40 % de son prix de vente.
- Le panel admin affiche en permanence le coût réel moyen par crédit et alerte si ce seuil est dépassé, par plan et par type d'usage.
- En cas de dépassement, ajuster les coûts en crédits des actions, pas les prix des plans.

## 4. Recharges et paiements

- Stripe : abonnements, achats ponctuels et factures automatiques.
- Saspay (mobile money FCFA, déjà en production) est conservé derrière la même interface de fournisseur de paiement (§ 10.6). D'autres moyens pourront s'ajouter sans toucher au moteur de crédits.
- Recharge ponctuelle : choix du palier, prix affiché en $ et FCFA avant l'achat.
- Recharge automatique : montant, seuil de déclenchement et plafond de dépense mensuel. La table `auto_topup_configs` existe déjà.

## 5. Transparence

- **Coût en direct** : affiché sur chaque message de l'agent, mis à jour à chaque étape pendant qu'il travaille (événement `cost_update`).
- **Estimation avant les tâches lourdes** : fourchette de coût, avec confirmation si le haut de la fourchette dépasse le seuil de l'utilisateur (défaut 5 crédits).
- **Pause automatique** d'un message qui dépasse le seuil (défaut 20 crédits), avec le choix Continuer ou Terminer.
- **Page Consommation** (Coden Cloud) :
  - graphique quotidien ;
  - répartition Build, Chat, Cloud, IA, Connecteurs ;
  - filtres par projet, par membre et par période ;
  - détail Cloud par catégorie.
- **Estimation du coût Cloud mensuel** de chaque projet, avec comparaison des tailles d'instance.
- **Alertes** :
  - solde bas ;
  - grant épuisé ;
  - crédits bientôt expirés ;
  - échec de recharge automatique ;
  - pic de consommation inhabituel.

## 6. Solde à zéro

- **Build** : il s'arrête avec un message clair et un bouton de recharge.
- **Message en cours** : il se met en pause (état `paused_balance`) et reprend là où il s'était arrêté après la recharge. Le transcript et les fichiers du tour sont déjà persistés par le harness des runs.
- **Backend Cloud** :
  - avertissement par e-mail et dans l'app à 10 %, puis à 0 % ;
  - pause après un délai de grâce configurable (défaut 72 h) ;
  - les données ne sont jamais supprimées.
- **Site publié** (frontend statique) : il reste en ligne.

## 7. Limites par membre

Le propriétaire du workspace fixe une limite mensuelle de crédits par défaut, ainsi que des limites individuelles par membre.

## 8. Panel admin

- Configuration de tous les tarifs, plans, grants et marges, par brouillon puis activation, avec historique des versions.
- Revenus, coûts OpenRouter et infrastructure, marge réelle par utilisateur, par projet, par plan et par type d'usage.
- Coût réel moyen par crédit, avec alerte au-dessus de 40 %.
- Attribution manuelle de crédits bonus (déjà livrée) et remboursements.

## 9. Ordre de réalisation

1. **Créer la table de configuration des tarifs et y insérer les valeurs par défaut de la section 3 bis.**
2. Schéma de base de données : soldes, grants, transactions, usage, tarifs.
3. Moteur de déduction et ordre de consommation.
4. Mesure du coût Build/Chat via OpenRouter.
5. Mesure de la consommation Cloud.
6. Stripe : plans, recharges ponctuelles et automatiques.
7. UI Consommation, alertes et gestion du solde à zéro.
8. Panel admin.

Toute opération sur les crédits est atomique et journalisée dans une table de transactions immuable, pour éviter les doubles déductions et permettre l'audit.

---

## 10. Schéma de base de données

Conventions :
- montants en crédits en `numeric(18,4)` (fractions de crédit exactes) ;
- montants en argent en `numeric(14,6)` USD, avec le FCFA calculé à l'affichage ;
- chaque table a la RLS active ;
- toute écriture passe par des fonctions `SECURITY DEFINER` exécutables par `service_role` uniquement.

### 10.1 Configuration des tarifs — *nouvelle* (étape 1)

```sql
create table billing_pricing_versions (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null unique,
  status        text not null check (status in ('draft','active','archived')),
  config        jsonb not null,               -- document complet, validé côté serveur (schéma ci-dessous)
  note          text,
  created_by    uuid, created_at timestamptz not null default now(),
  activated_by  uuid, activated_at timestamptz
);
create unique index one_active_pricing on billing_pricing_versions ((status)) where status = 'active';
-- Trigger : une version activée devient immuable (UPDATE de config refusé, DELETE refusé).
```

Pourquoi un document versionné plutôt que des lignes modifiables :
- chaque débit référence la version de tarif qui l'a calculé (`pricing_version_id`), ce qui rend l'historique toujours explicable ;
- l'admin prépare un brouillon, voit l'impact sur la marge (§ 12), puis l'active en une seule opération atomique ;
- un retour à la version précédente se fait en un clic.

Contenu de `config`, avec les valeurs initiales de la section 3 bis :

```jsonc
{
  "currency": { "base": "USD", "secondary": "XOF", "fx_secondary_per_usd": 600, "display_round_secondary": 100 },
  "credit":   { "reference_price_usd": 0.144, "max_cost_ratio": 0.40, "rounding": 0.01,
                "minimum": { "chat": 0.05, "build": 0.1 }, "provider_fee_rate": 0.055 },
  "plans": {
    "free":       { "monthly_usd": 0,  "annual_monthly_usd": null, "monthly_credits": 0,   "daily_build": 5, "daily_build_monthly_cap": 30, "topup_price_usd": null, "rollover_months": 0, "seats": 1 },
    "pro":        { "monthly_usd": 20, "annual_monthly_usd": 16,   "monthly_credits": 100, "daily_build": 5, "daily_build_monthly_cap": null, "topup_price_usd": 0.25, "rollover_months": 1 },
    "pro_plus":   { "monthly_usd": 45, "annual_monthly_usd": 36,   "monthly_credits": 250, "daily_build": 5, "daily_build_monthly_cap": null, "topup_price_usd": 0.22, "rollover_months": 1 },
    "business":   { "monthly_usd": 40, "annual_monthly_usd": 32,   "monthly_credits": 100, "daily_build": 5, "daily_build_monthly_cap": null, "topup_price_usd": 0.45, "rollover_months": 1, "team": true },
    "enterprise": { "custom": true }
  },
  "topup_tiers": [50, 100, 250, 500, 1000],
  "topup_validity_months": 12,
  "monthly_grants": { "cloud": 20, "app_ai": 5, "rollover": false },
  "indicative": { "small_edit": [0.3, 0.5], "medium_feature": [1, 2], "full_page": [2, 3], "chat": [0.05, 0.2] },
  "cloud": { "db_instance_month": { "small": 10, "medium": 30, "large": 80 }, "db_storage_gb_month": 1,
             "file_storage_gb_month": 0.5, "egress_gb": 0.5, "functions_per_100k": 1, "realtime_per_million": 1,
             "warn_at_ratio": [0.10, 0.0], "grace_hours": 72 },
  "transparency": { "default_confirm_above": 5, "default_pause_above": 20 },
  "alerts": { "low_balance_credits": 10, "expiring_within_days": 7, "spike_factor": 3 }
}
```

### 10.2 Workspace, membres et réglages

| Table | État | Rôle |
|---|---|---|
| `organizations` | existe | Le workspace. `plan` reste l'indicateur rapide. |
| `billing_accounts` | existe | 1 compte par workspace. |
| `workspace_members` | **nouvelle** | `(workspace_id, user_id, role owner/admin/member, monthly_credit_limit numeric null, status, invited_by, created_at)`. Remplace `member_credit_limits`, vide aujourd'hui. Le code lit une table `project_members` qui n'existe pas en base : ce sera corrigé. |
| `billing_account_settings` | **nouvelle** | `default_member_monthly_limit`, `confirm_above_credits`, `pause_above_credits`, préférences d'alerte (e-mail, in-app). |

### 10.3 Grants, registre et réservations — *existants, modifiés*

| Table | Modification |
|---|---|
| `credit_grants` | Restrictions étendues à `build`, `chat`, `agent` (build + chat), `cloud`, `app_ai`, `connectors` et `general`. Le grant quotidien devient `agent`, sauf avis contraire (voir question 3). Colonnes `pricing_version_id` et `plan_key` ajoutées. Nouveau kind `refund`. |
| `credit_ledger_entries` | Rendue **immuable** : trigger qui refuse UPDATE et DELETE, et privilèges retirés. Colonnes `category`, `user_id` (membre), `project_id`, `pricing_version_id` ajoutées. La clé d'idempotence unique existe déjà. |
| `usage_reservations` / `_lines` | Colonnes `turn_id` et `extends_reservation_id` ajoutées, pour augmenter une réservation pendant un long message. |
| `usage_events` | Colonnes `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `subagent_role`, `turn_id` et `credits_charged` ajoutées. Catégories : les 5 du § 1. |
| `usage_settlements` | Inchangée : revenu réalisé et marge par règlement. |

Fonctions atomiques (toutes `SECURITY DEFINER`, `search_path=''`, `service_role` seulement) :

| Fonction | État | Effet |
|---|---|---|
| `coden_billing_grant` | existe | Crée un grant et écrit le registre. Idempotente. |
| `coden_billing_reserve` | modifiée | Ordre spécifique → `agent` → `general` par expiration, puis kind (bonus, plan, recharge). Contrôle de la **limite du membre** dans la même transaction. |
| `coden_billing_extend` | **nouvelle** | Ajoute des crédits à une réservation en cours (message long, sous-agents). Échoue proprement → `paused_balance`. |
| `coden_billing_settle` / `_release` | existent | Règlent au coût réel mesuré et rendent le surplus réservé. |
| `coden_billing_charge` | **nouvelle** | Débit direct en une étape, pour le Cloud horaire et les connecteurs. Idempotent par `(projet, heure, ressource)`. |
| `coden_billing_refund` | **nouvelle** | Remboursement admin : grant `refund` et écriture liée au débit d'origine. |
| `coden_billing_expire` | **nouvelle** | Cron : expire les grants échus et écrit le registre. |

Anti double déduction :
- clé d'idempotence unique sur chaque réservation, débit et écriture ;
- verrouillage `FOR UPDATE` des grants dans un ordre déterministe ;
- un débit rejoué renvoie la ligne existante au lieu d'en créer une nouvelle.

### 10.4 Consommation Cloud — *nouvelles*

```sql
cloud_usage_samples (id, project_id, resource, quantity numeric, unit, sampled_at, source, raw jsonb)
cloud_usage_hourly  (project_id, hour timestamptz, resource, quantity, credits numeric(18,4),
                     pricing_version_id, ledger_entry_id, primary key (project_id, hour, resource))
cloud_project_billing (project_id pk, instance_size, state active/warned_10/warned_0/grace/paused,
                       grace_until, paused_at, last_warned_at, estimated_monthly_credits)
```

- **Collecte** : un job toutes les 5 minutes interroge l'API de gestion Supabase (usage, taille de la base) et le stockage, puis écrit les échantillons.
- **Agrégation** : un job horaire regroupe les échantillons dans `cloud_usage_hourly`, puis appelle `coden_billing_charge` (grant Cloud d'abord, puis crédits généraux).
- `cloud_usage_ledger` et `cloud_wallets` (v1, vides ou inutilisés) sont retirés après migration.

### 10.5 Transparence et pause — *nouvelles*

```sql
agent_turn_billing (turn_id pk, account_id, user_id, project_id, reservation_id,
                    credits_so_far numeric(18,4), estimate_low, estimate_high,
                    pause_above numeric, approved_up_to numeric,
                    state running/paused_threshold/paused_balance/completed/ended, updated_at)
billing_alert_log (account_id, kind, period_key, channel, sent_at, unique (account_id, kind, period_key, channel))
```

`billing_alerts_v2` (existe) reste la source des alertes affichées dans l'app ; `billing_alert_log` empêche d'envoyer deux fois la même alerte.

### 10.6 Paiements — *existants, étendus*

| Table | État | Rôle |
|---|---|---|
| `billing_provider_customers` | existe | Client par fournisseur (`stripe`, `saspay`). |
| `billing_checkout_intents` | existe | Achat ponctuel ou abonnement, par fournisseur. |
| `billing_subscriptions_v2` | existe | Abonnement Stripe ou Saspay. |
| `auto_topup_configs` | existe | Seuil, montant, plafond mensuel, moyen de paiement enregistré. |
| `billing_invoices` | **nouvelle** | `(provider, provider_invoice_id, account_id, amount, currency, status, hosted_url, pdf_url, period)`. |
| `provider_webhook_events` | existe | Déduplication des webhooks par identifiant d'événement (utilisée par Saspay, reprise pour Stripe). |

Interface côté serveur :

```ts
interface PaymentProvider {
  createSubscriptionCheckout(...); createTopupCheckout(...); chargeSavedMethod(...); // recharge auto
  openCustomerPortal(...); verifyWebhook(req): ProviderEvent; // signature obligatoire
}
// StripeProvider, SaspayProvider — le moteur de crédits ne connaît que des ProviderEvent normalisés.
```

Webhooks Stripe traités :
- `checkout.session.completed` ;
- `invoice.paid` : grant mensuel du plan ;
- `invoice.payment_failed` ;
- `customer.subscription.updated` et `customer.subscription.deleted` ;
- `payment_intent.succeeded` et `payment_intent.payment_failed` : recharge automatique.

La signature est toujours vérifiée, et l'identifiant de l'événement est dédupliqué.

### 10.7 Admin

- **Vues** : `billing_revenue_daily`, `billing_cost_per_credit` (par plan et par catégorie), `billing_margin_by_account` et `billing_margin_by_project`, calculées depuis `usage_events` et `usage_settlements`.
- **Journal** : `admin_audit_log` (existe) enregistre toute modification de tarif, tout octroi et tout remboursement.

---

## 11. Architecture

```
            Navigateur (builder, Consommation, admin)
                    │  SSE : cost_update, cost_pause_requested, balance_paused
                    ▼
  ┌──────────────────────── Serveur Express ────────────────────────┐
  │ PricingService    lit la version active (cache 30 s), valide les brouillons  │
  │ CostEstimator     fourchette avant tâche lourde (historique par modèle/route) │
  │ MeteringService   convertit coût réel → crédits (formule § 2)                │
  │ CreditEngine      reserve / extend / settle / release / charge / refund (RPC)│
  │ TurnBilling       coût en direct, pause au seuil, pause solde, reprise       │
  │ CloudMeter        jobs 5 min (collecte) + 1 h (agrégation + débit)           │
  │ BillingNotifier   alertes in-app + e-mail (Resend), dédupliquées             │
  │ PaymentProviders  Stripe | Saspay (interface commune, webhooks signés)       │
  └──────────────────────────────┬──────────────────────────────────┘
                                 │ service_role uniquement
                                 ▼
          Postgres (Supabase) : tables § 10 + fonctions atomiques + registre immuable
```

**Flux d'un message de Build :**
1. Estimation : le planificateur produit le plan, et `CostEstimator` donne une fourchette. Au-dessus du seuil, une confirmation est demandée.
2. Le moteur de crédits réserve le haut de la fourchette, dans la limite du solde et de la limite du membre.
3. Chaque étape (agent, sous-agents) remonte son coût réel (`onSpend` existe déjà). Le serveur convertit ce coût en crédits et émet `cost_update`.
4. Au passage du seuil de pause, la réservation est étendue. Au passage de `pause_above`, le tour se met en pause (`paused_threshold`) et attend Continuer ou Terminer.
5. Si l'extension de la réservation échoue faute de solde, le tour passe en `paused_balance` : un bouton de recharge s'affiche, puis le tour reprend.
6. À la fin, le règlement se fait au coût réel exact, le surplus réservé est libéré, et l'écriture au registre porte la version de tarif.

---

## 12. Analyse de rentabilité des tarifs par défaut

Hypothèses :
- prix de vente d'un crédit = prix du plan ÷ crédits ;
- plafond de coût réel = 40 % de ce prix.

| Offre | Prix/crédit | Coût réel max/crédit |
|---|---|---|
| Pro mensuel | 0,200 $ | 0,080 $ |
| Pro annuel | 0,160 $ | 0,064 $ |
| Pro+ mensuel | 0,180 $ | 0,072 $ |
| **Pro+ annuel** | **0,144 $** | **0,0576 $** ← le plus bas |
| Business mensuel / annuel | 0,400 / 0,320 $ | 0,160 / 0,128 $ |
| Recharges | 0,22 à 0,45 $ | 0,088 à 0,18 $ |

1. **Base de conversion.** Pour respecter les 40 % partout, 1 crédit doit correspondre à au plus **0,0576 $** de coût réel : c'est le prix de référence 0,144 $ × 0,40, utilisé dans la configuration ci-dessus. Les repères de la section 3 bis restent atteignables : une petite modification à 0,3–0,5 crédit correspond à 0,017–0,029 $ de coût réel, possible avec les modèles économiques.
2. **Crédits quotidiens des plans payants, sans plafond.** Jusqu'à 150 crédits gratuits de plus par mois (5 × 30). Un client Pro annuel qui utilise tout reçoit 250 crédits pour 16 $, soit 0,064 $ le crédit. Son coût réel peut alors atteindre 90 % du prix au lieu de 40 %. Options :
   - (a) plafonner ces crédits, par exemple 30/mois ;
   - (b) les limiter aux modèles économiques ;
   - (c) les accepter comme coût d'acquisition.
   Le panel admin mesurera l'écart réel.
3. **Cloud.** Si chaque app a son propre projet Supabase, une instance « petite » à 10 crédits (≈ 1,44–2 $ de revenu) coûte environ 10 $/mois chez Supabase. **Recommandation** :
   - « petite » = schéma dans un projet Supabase partagé (le mode `shared` existe déjà, coût marginal quasi nul) ;
   - « moyenne » et « grande » = projets dédiés, facturés au-dessus de leur coût réel.
4. **Unités Cloud.** À vérifier sur supabase.com/pricing ; valeurs de mémoire, susceptibles d'avoir changé :
   - réseau ≈ 0,09 $/Go, contre 0,5 crédit ≈ 0,072 $ ;
   - fonctions ≈ 0,20 $/100 000, contre 1 crédit ≈ 0,144 $ ;
   - Realtime ≈ 2,50 $/million, contre 1 crédit ≈ 0,144 $.

   Ces trois postes seraient vendus sous leur coût. Le tableau admin « coût réel par crédit par type d'usage » le fera ressortir. Il faudra ajuster les coûts en crédits, conformément à la règle de rentabilité.

## 13. Questions à trancher avant le code

1. **Plan Gratuit « 5/jour, une fois »** : faut-il lire 5 crédits par jour avec un plafond mensuel (30 aujourd'hui), ou 5 crédits une seule fois à l'inscription (règle actuelle `one_time_free_5`) ?
2. **Business** à 40 $ pour 100 crédits, soit plus cher que Pro+ par crédit, avec une recharge à 0,45 $ : est-ce un prix par siège ? La recharge Business doit-elle vraiment être plus chère que la recharge Pro ?
3. **Crédits quotidiens** : valables pour le Build seulement, ou aussi pour le Chat (les deux sont des messages de l'agent) ? Proposition : les deux.
4. **Point 12.2** : faut-il plafonner les crédits quotidiens des plans payants ?
5. **FCFA** : XOF (UEMOA, Afrique de l'Ouest) ou XAF (CEMAC, Afrique centrale) ? Les deux ont la même parité. La v2 utilise `XAF` avec 600 FCFA pour 1 $.
6. **Stripe** : existe-t-il déjà un compte Stripe pour Coden ? Saspay reste-t-il le moyen de paiement FCFA par défaut ?
