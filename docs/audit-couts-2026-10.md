# Audit des coûts de Coden, octobre 2026

Mesuré le 2026-10-01 en lecture seule (base de production, journaux Railway, code). Chaque chiffre porte son statut :
**M** mesuré, **E** estimé, **S** supposé. Tarifs publics vérifiés le jour même, avec leur source. Aucun prompt ni donnée
personnelle dans ce rapport.

## 1. Ce que l'audit change dans la lecture du problème

1. **La facturation est en mode « ombre » en production (M).** `CODEN_MONETIZATION_V2_ENABLED` n'est pas défini sur Railway :
   aucun crédit n'est réservé ni débité, `estimateActionCost` renvoie 0 crédit, 0 abonnement, 16 paiements initiés, 0 payé.
   Il n'y a donc **aucune marge réalisée** : tout ce qui suit sur la marge est modélisé à partir du barème public.
2. **Les dépenses sont pour l'essentiel invisibles dans le registre (M).** `usage_events` contient 46 lignes pour 1,80 $ ; les
   tours d'agent rapportent 3,15 $ (`agent_turns.budget_used.costUsd`). Les tours échoués, annulés ou bloqués (2,45 $) n'y étaient
   jamais écrits ; les runs réussis y apparaissaient étiquetés `*_failed` (corrigé : `*_shadow`). Corrigé par le lot 1 (capture).
3. **Le premier poste de coût n'est pas le modèle le plus cher, c'est l'échec (M).** 133 tours échoués sur 301 : **2,03 $ sur
   3,15 $ (64 %)** pour 44 % des tours. Un tour échoué coûte en moyenne 0,015 $ de plus qu'un tour réussi parce qu'il fait plus
   de rounds (jusqu'à 7 réparations, 323 appels d'outil sur un seul tour). La fiabilité est le levier de marge n° 1.

## 2. Carte de l'existant

| Domaine | Où | Réutilisé |
|---|---|---|
| Plans, crédits, prix | `src/config/billing-v2.ts` (FCFA, 600 FCFA = 1 $) ; schéma « v3 » en dollars en ombre (`billing/pricing-config.ts`) | oui, jamais modifié |
| Registre des coûts | `usage_events`, `usage_settlements`, `model_routing_events`, `provider_cost_catalog`, `provider_reconciliations` | étendu |
| Alertes et plafonds | `admin-costs.ts`, `spend_limits`, `admin_cost_alerts`, `alertProviderOnce`, `hardCapReached` | réutilisés |
| Routeur | `routing-policy.ts` (poids par mode, `CODEN_ROUTING_POLICY`, retour `CODEN_ROUTER_V2=0`), `model-selection.ts`, `model-supervisor.ts` | inchangé |
| Modes | `src/lib/routing-mode.ts` : **Économique**, Équilibré, Performance (la demande disait « Économie » : le nom du dépôt est conservé) | inchangés |
| Modèles par plan | `src/config/ai-models.ts` (`minPlan`, `tier`) | inchangé |
| Cache de prompt | `prompt-caching.ts` (Anthropic explicite, OpenAI/Gemini automatique) | mesuré, déjà bon |
| Agent | `multi-agent-pipeline.ts` (3 / 6 / 8 rounds, 3 / 8 / 11 min), `sandbox/repair-loop.ts` (8 rounds), sous-agents (5 en parallèle) | inchangé |
| Hébergement | Railway (app), Supabase (base), E2B (aperçus), Cloudflare Pages (apps publiées), Resend, SasPay, Composio, Firecrawl, fal | voir §4 |

Qui paie quoi pour les apps générées : **Coden** paie l'hébergement Pages de l'app, l'aperçu E2B pendant la génération et les
appels de modèles ; **l'utilisateur** paie ses propres comptes connectés (Supabase, Resend…) quand il les relie.

## 3. Modèles d'IA (premier poste mesuré)

| Mesure | Valeur | Statut |
|---|---|---|
| Dépense totale des tours, 8 jours | 3,15 $ (≈ 0,4 $/jour, pic 1,26 $ le 28/09) | M |
| Répartition par issue | échoué 2,03 $ · terminé 0,70 $ · annulé 0,33 $ · bloqué 0,10 $ | M |
| Coût moyen par run enregistré | petite modif 0,014 $ (n=8) · grosse modif 0,042 $ (n=9) · nouveau projet 0,106 $ (n=11) | M, petit échantillon |
| Taux de lecture du cache | Économique 92 % · Équilibré 88 % · Performance 95 % | M (n=8 runs) |
| Contexte envoyé | 0,56 à 1,9 million de tokens d'entrée par build, re-envoyés à chaque round | M |
| Latence moyenne d'un run | Économique 505 s (n=5) · Équilibré 126 s (n=2) · Performance 865 s (n=1) | M, n trop petit |
| Concentration | un seul compte = 60 % de la dépense ; médiane par compte 0,048 $, p90 0,207 $, max 1,90 $ (20 comptes) | M |
| Frais d'achat OpenRouter | 5,5 % déjà intégrés au coût enregistré | M (code) |
| Solde OpenRouter | 5,98 $ (alerte à 20 $ active) | M |

Constat sur les prix : le registre (`ai-models.ts`) et `provider_cost_catalog` portent kimi-k3 à 3 $/15 $ par million ;
la table `ai_model_pricing` (non lue par le code) dit 0,6 $/2,5 $. Seul le catalogue OpenRouter en direct fait foi pour la facture :
le lot 1 compare désormais registre et catalogue en direct chaque jour et garde l'historique daté.

Politique de données (M, code) : la requête OpenRouter ne fixe que `provider.require_parameters`. Ni `data_collection: 'deny'`
ni zero data retention : à régler (drapeau `CODEN_OR_DATA_DENY`, lot 4) après test de conformité, car cela réduit le choix de
fournisseurs et peut produire des erreurs « aucun endpoint ».

## 4. Calcul, hébergement, services tiers

| Poste | Coût | Source | Statut |
|---|---|---|---|
| Railway (app, 1 instance) | CPU moyenne 0,038 vCPU, mémoire moyenne 0,36 Go (max 0,88) → ≈ 0,76 $ + 3,6 $ d'usage par mois ; plan Hobby 5 $ (crédit inclus) ou Pro 20 $ | métriques Railway ; [tarifs](https://comparedge.com/tools/railway/pricing) : 20 $/vCPU/mois, 10 $/Go/mois | E |
| Supabase | base 93 Mo, stockage 7 Mo, 31 utilisateurs ; compute « micro » 0,01344 $/h ≈ 9,8 $/mois | `provider_cost_catalog` (sources Supabase) | M (taille), E (facture) |
| E2B (aperçus) | 0,000014 $/vCPU/s et 0,0000045 $/Go/s ; sandbox par défaut 2 vCPU / 512 Mo ≈ 0,109 $/h ; Hobby gratuit avec 100 $ de crédit une fois, 1 h de session max, 20 sandboxes simultanées ; Pro 150 $/mois | [e2b.dev/pricing](https://e2b.dev/pricing) | tarif M, usage S |
| Resend | 20 $/mois + 0,0009 $/e-mail | `provider_cost_catalog` | M |
| Cloudflare | Workers payant 5 $/mois ; Pages : **limite de projets par compte** (la source consultée dit 30 en offre gratuite, 500 builds/mois, 20 000 fichiers par site : [synthèse](https://dev.to/david_viejo_4d48fdfa7cfff/cloudflare-pages-free-tier-limits-pricing-2026-1f8f)). Le compte en porte déjà 63 : limite à vérifier dans le tableau de bord | recherche web | S |
| SasPay | frais de paiement inconnus (aucune source publique) | — | S : 3 % retenu |
| Firecrawl, Composio, fal | pas de ligne de coût dans le catalogue ; à relever sur les factures | — | non chiffré |
| Vercel | jamais abouti (0 publication), désactivé ; aucun coût engagé | base `deployments` | M |

Coûts fixes mensuels estimés : Railway 5 à 20 $ + Supabase ≈ 10 à 25 $ + Resend 20 $ + Cloudflare 5 $ ≈ **40 à 70 $**
(E). Point mort : environ 5 à 8 abonnements Pro à 25 crédits (8,33 $ net chacun) ou 3 à 4 Business.

**Risque d'échelle (E) :** une publication = un projet Cloudflare Pages. Au-delà du plafond de projets du compte, chaque
publication échouera. Alternative à étudier (non appliquée) : un seul Worker qui sert les sites depuis un stockage, sans plafond
de projets, pour un coût marginal proche de zéro. Le même mécanisme règle l'hébergement indéfini des apps du plan Free.

## 5. Revenus et marge (modélisés, pas réalisés)

Barème : Pro 25 crédits = 5 000 FCFA (0,333 $/crédit), Pro 100 = 15 000 FCFA (0,25 $), Business 100 = 30 000 FCFA (0,50 $),
annuel −20 %. Net de frais de paiement 3 % (S), sans taxe (S : à confirmer si le prix affiché est TTC). Module :
`src/services/margin-model.ts`, tableau reproductible : `node --experimental-strip-types scripts/cost/margin-table.ts`.

| Type de run (coût mesuré, n) | Crédits | Pro 25 | Pro 100 | Business 100 |
|---|---|---|---|---|
| Petite modification : 0,014 $, n=8 | 0,9 | 95 % | 94 % | 97 % |
| Grosse modification : 0,042 $, n=9 | 1,2 | 89 % | 85 % | 93 % |
| Nouveau projet : 0,106 $, n=11 | 1,7 | 81 % | 74 % | 87 % |
| **Run premium (Opus/Fable) estimé : 1,9 $** | 1,7 | **perte** | **perte** | **perte** |

Lecture : avec les modèles qu'Auto choisit aujourd'hui, la marge brute des runs mesurés est **au-dessus du plancher de 55 %**
et, sauf « nouveau projet » en Pro 100 (74 %), au-dessus de la cible de 80 % pour les petits runs. **Un run sur un modèle
premium est vendu à perte quel que soit le plan (E)** : les crédits sont plats par action (« le modèle et l'effort ne réécrivent
jamais le prix »), alors que le coût dépend du modèle. Le coût maximal d'un run pour garder 55 % : page complète 0,185 $ en
Pro 100 et 0,371 $ en Business 100.

Sensibilité (Pro 100, page complète, 0,106 $) : base 74 % ; modèles +20 % : 69 % ; franc −10 % : 72 % ; taxe 19,25 % incluse :
69 % ; frais de paiement 5 % : 74 % ; **coût du run ×3 : 23 %** (une tâche lourde avec plusieurs essais suffit à effacer la marge).

Utilisateurs Free (E) : chaque compte reçoit 5 crédits de bienvenue avec un plafond de coût de 1 $ (M, `credit_grants`), plus des
crédits quotidiens de build (5 crédits, plafond 0,09 $/jour) et des dotations mensuelles IA et Cloud (0,06 $ et 0,37 $). Si tous
étaient consommés, l'exposition serait de l'ordre de 4 $ par compte et par mois : **à confirmer avant d'activer la facturation**
(les crédits quotidiens ne figurent pas dans l'offre Free affichée).

## 6. Ce qui est appliqué (invisible, derrière drapeaux, sans changer un prix)

| # | Changement | Drapeau | Gain |
|---|---|---|---|
| 1 | Capture du coût des tours échoués, annulés, bloqués (mesure seulement) | `CODEN_COST_CAPTURE=0` coupe | couverture de la mesure : de ≈ 20 % vers la totalité |
| 2 | Étiquette `*_shadow` pour un run vérifié non facturé (avant : `*_failed`) | — | exactitude du registre |
| 3 | Rapprochement quotidien OpenRouter (écart > 5 % ou > 0,05 $ alerté) | `CODEN_COST_RECONCILE=0` | confiance dans le registre |
| 4 | Suivi daté des prix de modèles, alerte à +/−10 % | `CODEN_PRICE_SYNC=0` | marge protégée d'une hausse de tarif |
| 5 | Test d'invariance : prix, plans, paliers, crédits, coût des actions, modèles, modes, niveaux de raisonnement | test `visible-invariance` | garantie « rien de visible ne bouge » |
| 6 | Modèle de marge paramétrable | — | décision chiffrée |

Gains **mesurés** en dollars : aucun encore, et c'est dit honnêtement : le lot 1 est de la mesure, il ne peut pas réduire une
dépense qu'il ne voyait pas. Les économies viennent des lots suivants, une fois la mesure complète.

## 7. Recommandations chiffrées (non appliquées, à décider)

1. **Plafonner le coût d'un run premium** (interne, invisible) : nombre de rounds et de sous-agents borné par le coût maximal
   ci-dessus (0,19 à 0,37 $ pour une page complète) quand Auto choisit un modèle premium, avec repli signalé à l'utilisateur.
   Un modèle **choisi explicitement** reste servi tel quel : si la combinaison reste à perte, c'est une décision de prix
   (hausse du coût en crédits des modèles premium ou crédits plus bas par palier), pas une économie interne.
2. **Réduire l'échec avant tout** : 64 % de la dépense mesurée part dans des tours échoués. Une baisse de moitié des échecs
   vaut plus que n'importe quel changement de fournisseur.
3. **Activer la facturation** (`CODEN_MONETIZATION_V2_ENABLED=1`) seulement après : couverture du registre vérifiée sur une
   semaine, plafonds de coût réel en observation, et décision sur les crédits quotidiens des comptes Free.
4. **Contrats** (rien n'est demandé) : crédits de programme startup chez OpenRouter/E2B/Supabase ; compte direct Anthropic ou OpenAI
   pour les un ou deux modèles dominants (économie maximale de 5,5 % des frais d'achat, soit ≈ 0,17 $ au volume actuel : sans
   intérêt avant plusieurs centaines de dollars par mois) ; engagement Railway/Supabase seulement après stabilisation.
5. **Hébergement des apps** : vérifier le plafond de projets Pages du compte ; étudier un Worker unique avant d'ouvrir à beaucoup
   d'utilisateurs.

## 8. Tableau final

| Problème | Cause racine | Correction | Mesure avant/après | Reste à faire |
|---|---|---|---|---|
| Coûts invisibles | le registre n'écrit que les runs qui reviennent avec un résultat | capture des tours terminés, étiquette exacte | couverture ≈ 20 % → à mesurer sur 7 jours | rapprochement à lire après 24 h |
| Prix modèles non suivis | trois sources (registre, catalogue SQL, catalogue en direct) | synchronisation datée + alerte | aucun historique → historique | décider quand le registre doit suivre le direct |
| Marge inconnue | facturation en ombre, 0 revenu | modèle de marge, barème public | — | activer la facturation après vérifications |
| Dépense dominée par l'échec | tours longs, réparations en boucle | non traité ici (lot 4, après mesure) | 64 % de la dépense | réduire les échecs, borner les rounds |
| Runs premium à perte (E) | crédits plats, coût variable | recommandation chiffrée | — | décision de prix ou plafond de coût en Auto |
| Politique de données | pas de `data_collection: deny` | drapeau prévu, désactivé | — | test de conformité par fournisseur |
| Limite de projets Pages | un projet par app | alerte dans ce rapport | — | vérifier le plafond, étudier un Worker |

## 9. Hypothèses et limites

- Aucune facture fournisseur n'est lisible depuis l'environnement de développement (OpenRouter, Railway, Supabase, E2B, SasPay
  inaccessibles) : tout coût de service tiers est un tarif public ou une estimation, sauf mention.
- Échantillon : 301 tours, 28 runs de build enregistrés, 8 synthèses de routage, 20 comptes dont un domine : médianes et
  percentiles sont indicatifs.
- Pas de banc avant/après des trois modes : il demande des clés OpenRouter et E2B que cet environnement n'a pas. Le jeu de
  référence et le script seront lancés en production depuis l'admin avec un plafond de coût propre, après accord.
- Taux de frais de paiement (3 %), taxe (0 %), remboursements (0 %), part de crédits consommés (100 %) : hypothèses, modifiables
  dans `margin-model.ts`.
- Rien de visible n'a été modifié : prix, plans, paliers, crédits, coût en crédits, estimation affichée, modèles, modes et niveaux
  de raisonnement sont identiques (test d'invariance).
