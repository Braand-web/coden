# Coden — audit des coûts au 1er octobre 2026

## Conclusion et périmètre

La rentabilité permanente n'est pas démontrable avec les données disponibles. Le registre actuel ne couvre pas toutes les exécutions, les factures fournisseurs ne sont pas rapprochées et les paiements nets ne sont pas établis. Aucun gain mensuel réalisé n'est revendiqué. Les optimisations de routage, fournisseurs, contexte, qualité et infrastructure restent **non activées**.

Audit distant en lecture seule, sans génération IA payante, sans achat, sans changement d'offre, DNS, données, ressources ou facturation. Plafond choisi pour l'audit : **0 USD d'appels IA payants** ; collecteur borné à 100 lectures et 50 000 lignes par table et exécution. Les lectures consomment néanmoins des ressources de l'infrastructure existante ; leur coût marginal n'est pas mesuré. La dernière collecte a effectué 13 lectures. Les secrets ont été utilisés en mémoire, jamais inscrits au rapport ni au dépôt. Aucun email, prompt, réponse ou identifiant brut d'utilisateur n'est inclus.

Production observée : commit `97a6ac7cb53ac1b643f9669e38f73bf7939ffb0b`, déploiement Railway `85003ae2-203d-437a-a0b7-a44f50c445cc`, SUCCESS, créé le 2026-10-01 à 00:38:20 UTC. Santé HTTP : `success=true`, `status=ok`. Fenêtre du registre : 2026-09-01 00:00 UTC au 2026-10-01 01:22:28 UTC. Ce n'est pas une fenêtre strictement limitée au mois civil de septembre.

Travail isolé sur `feat/cost-observability-20261001`, dans `../coden-cost-control`. Les changements préexistants de `.env.example` et `src/auth.ts` du checkout principal ont été préservés. La tâche précédente Runtime partagé n'est pas reprise ni déployée ici. Les chiffres et la carte ci-dessous sont le relevé historique du 1er octobre au commit `97a6ac7`, pas des soldes actuels. Le 3 octobre, le code a été intégré à `origin/main`, d'abord `31b2368`, puis au nouveau commit production `7955140`, pour conserver les correctifs de publication, d'agents, de sécurité, de paiement et de mesure des coûts. Le nouveau service Railway vérifié sert `coden.fun` depuis `Braand-web/coden`. Le déploiement demandé concerne uniquement le socle **flag désactivé**, sans mutation SQL ni activation d'économies ; voir `cost-observability-deployment-2026-10-03.md`.

## 1. Carte de l'existant vérifié

- Builder : `src/builder-live.ts`, composer partagé `src/components/ui/ai-chat-input.tsx`, SSE/harness et persistance des sessions dans `server.ts`. Dashboard séparé ; aucune modification de son interface.
- Orchestration : `multi-agent-pipeline.ts`, planner/coder, exploration, spécialistes, revue et vision ; budgets `quality-tier.ts`, reprise par checkpoint, politiques de qualité et jeu de référence existant de 32 tâches. Certaines routes utilisent encore le générateur historique. En production le pipeline dépend de la disponibilité d'un sandbox isolé ; un échec de cette condition renvoie vers le parcours sans exécution sandbox.
- Modèles : catalogue `src/config/ai-models.ts`, OpenRouter, catalogue vivant `openrouter-capabilities.ts`, requête unique `openrouter-request.ts`, cache Anthropic déjà présent dans `prompt-caching.ts`. Les coûts retournés existent, mais cache/raisonnement ne sont pas conservés de manière exploitable dans le registre agrégé consulté.
- Routeur : `model-selection.ts`, `routing-policy.ts`, modes exacts **Économique, Équilibré, Performance**, mode Auto et choix manuel. Router V2, politiques et expériences déjà sous flags. Raisonnement : `none/low/medium/high/max`, avec les libellés UI existants conservés.
- Plans/crédits : catalogue FCFA legacy `billing-v2.ts` et catalogue configurable V3 `billing/pricing-config.ts`/`billing_pricing_versions`. **Deux contrats coexistent : ne pas les fusionner ni les remplacer arbitrairement.** Estimation/action inchangées.
- Paiements : Saspay, intentions de checkout, réservations/settlements d'usage, recharges et grants. `usage_events`, `usage_settlements`, alertes admin et budgets existent déjà. Ce registre mélange coûts déclarés et estimations sans provenance suffisamment explicite.
- Calcul : sandbox registry, plafond mémoire dynamique, arrêt d'inactivité 15 minutes, leases des tâches actives ; cache de dépendances basé sur manifest/lockfile, jusqu'à quatre entrées. Ne pas réimplémenter ces économies déjà présentes.
- Publication : `publish-vercel.ts` utilise la clé de plateforme `VERCEL_TOKEN`. Un backend Cloudflare est dans le code mais aucun token Cloudflare n'a été relevé dans les variables du service. Les apps publiées ne sont pas nécessairement hébergées sur Railway. Le frontend des previews et le backend d'une app sont des postes distincts.
- Backend : Supabase central `ftmbiocvslxctldfihcp`, données Coden/Auth/Storage. Le provisioning dédié par app existe encore dans `supabase-auto-provision.ts`. Le Runtime partagé `hhktmwppxsbdeyqkxaal` est un projet distinct, non basculé en production par cet audit.
- Services : Firecrawl pour recherche web et pièces jointes/liens, Resend pour mails plateforme ; clés de projet chiffrées pour les apps (`project-secrets.ts`, écran Cloud). Google OAuth passe par Supabase. Search Console est un outil de référencement, pas une preuve d'une API payante runtime. L'existence d'un connecteur/logo n'implique pas un abonnement actif.
- Admin : `admin-live.ts`, onglet Coûts et alertes, budgets globaux/utilisateurs/modèles, notification Slack/Resend (`admin-alert-notifier.ts`), solde OpenRouter. Les rapports de marge existants sont une allocation des crédits, pas une comptabilité nette des ventes.
- Skills/mémoire : skill Coden de design, contexte ciblé, mémoire de projet, connaissance partagée, pièces jointes et extraction. `agent-self-improvement.ts` fabrique des signaux/mémoires ; aucun changement autonome de prix/plafond par cette tâche. Le nouveau contrôle n'est exposé à aucun outil de sous-agent.

### Qui paie les apps générées ?

- Coden paie ses appels IA, son service Railway, ses previews serveur, sa base centrale, les outils utilisant une clé plateforme et les publications envoyées avec son token Vercel.
- Resend/IA/services utilisant une **clé propre au projet** sont facturés au propriétaire de cette clé. Une capacité affichée dans Cloud ne prouve pas que la clé existe, ni que Coden subventionne son usage.
- Un projet Supabase créé via le compte de gestion Coden implique un coût/quota dans cette organisation. Un backend externe connecté par le propriétaire est payé par ce dernier. Attribution facturable projet par projet encore nécessaire.
- Les domaines « illimités » Business ne sont pas un abonnement fournisseur illimité. Distinguer coût d'enregistrement du domaine acheté par le client, opérations de connexion, trafic, DB, mails et fonctions.

## 2. Mesures disponibles et limites

### Registre central — mesuré dans la projection consultée

- 44 événements : 18 `ai_gateway`, 26 `build` ; tous associés à OpenRouter.
- Coût fournisseur enregistré : **1,644790856 USD** ; coût complet enregistré : **1,648490856 USD**, dont allocation plateforme **0,0037 USD**. L'allocation n'est pas une facture d'infrastructure réelle.
- 18 settlements, **18,5 crédits** attribués, « revenu réalisé » alloué **0,32 USD**. Ce montant n'est pas un encaissement bancaire ni un revenu net de TVA/frais.
- 14 événements sans `run_id`, 30 runs avec un coût associé pour 217 runs au total. Cette fraction ne mesure pas directement le nombre d'appels manquants : les agrégations et les routes diffèrent.
- Aucun des 44 événements ne conserve un champ cache ou raisonnement exploitable : **inconnu**, et non taux de cache nul.
- Coût par modèle dans ce registre : `openai/gpt-5.6-luna` 0,707767150 USD (30 événements) ; `moonshotai/kimi-k3` 0,489339376 (2) ; `openai/gpt-6-luna` 0,381360780 (7) ; `google/gemini-3.8-flash` 0,063130430 (4) ; `openai/gpt-5.6-luna-pro` 0,006893120 (1). Les parts ne valent que pour le registre observé, pas le coût total du SaaS.
- Tokens d'entrée enregistrés : 5 258 052 sur GPT-5.6 Luna, 372 473 sur Kimi, 9 378 019 sur GPT-6 Luna ; sorties 124 803, 18 571, 107 143. Une ligne agrégée peut contenir plusieurs itérations : ne pas appeler son quotient « contexte par appel ».
- Distribution des 7 comptes avec coûts : médiane 0,02314635 USD, p90/p99 1,50697248 USD ; le plus gros compte représente environ 91,4 % de ce registre. Petit échantillon, comptes internes/tests non distingués : aucun diagnostic d'abus ou de marge par plan n'en découle.
- 217 runs : 101 `completed`, 116 `failed`. Intentions : 80 build, 43 clarification, 21 debug, 51 conversation, 22 edit. **Ce ratio mélangé n'est pas le taux de réussite des apps.** Durées p50 7 938 ms, p95 418 225 ms, toutes intentions mélangées.
- Échecs : 84 `RUN_INTERRUPTED`, 10 `PROVIDER_TIMEOUT`, 6 `MODEL_CAPABILITY_UNAVAILABLE`, 4 `GENERATION_FAILED`, 3 `VERIFICATION_INCOMPLETE`, 3 `PROVIDER_QUOTA_OR_BILLING`, et six codes à une occurrence. Une baisse de ces échecs peut réduire les relances ; économie non chiffrable tant que les coûts des échecs manquent.
- 19 événements de routage seulement : 15 Économique, 4 Équilibré, aucun Performance. Aucune comparaison fiable des trois modes aujourd'hui.
- 120 projets créés sur la fenêtre ; ce ne sont ni 120 utilisateurs uniques ni 120 apps terminées.

### OpenRouter — mesuré, périmètres distincts

Compte crédits : 45 USD déposés, 43,863364743 USD d'usage cumulé, reste **1,136635257 USD**. Clé actuellement configurée : usage cumulé **13,213083123 USD**, semaine **3,623428062 USD**. Les champs du nouveau mois/jour sont à zéro au moment de la lecture, pas les coûts de septembre.

L'usage du compte, de la clé et du registre n'ont pas la même période ni le même périmètre. Ne pas soustraire ces valeurs pour inventer un écart de rapprochement. Il faut l'export fournisseur daté, l'historique des clés, remboursements/crédits, frais d'achat et factures. **Écart <5 % non démontré.**

### Infrastructure et tiers

Railway, résumé des 7 jours précédents : CPU moyen **0,013388 vCPU**, pic 0,26049 ; RAM moyenne **530,03 MB**, pic historique 1 748,45 MB, valeur courante 353,83 MB, limite actuelle environ 1 GB. Un pic historique peut inclure un déploiement/chevauchement : ne pas conclure à une violation actuelle de limite. Ne pas réduire la RAM des previews à partir d'une moyenne.

Projection **estimée**, pas facture : avec RAM MB décimaux convertis en GB et usage moyen constant pendant un mois, CPU+RAM ≈ **5,57 USD/mois** (`0,013388×20 + 0,53003×10`). Hors réseau, autres services, stockage, taxes et minimum d'offre du workspace. Les métriques réseau obtenues sont des moyennes/résumés, pas un total facturable ; aucune extrapolation de trafic mensuel n'est revendiquée. Le minimum d'offre inclut de l'usage : ne pas l'ajouter automatiquement deux fois. [Tarifs Railway](https://docs.railway.com/pricing/plans).

Vercel : la seule équipe visible avec le token de plateforme est `hobby/active`. La correspondance avec un `VERCEL_TEAM_ID` configuré n'a pas été démontrée. **Confirmer le scope des déploiements avant de conclure sur la facture.** Hobby n'autorise que l'usage personnel non commercial ; cela exclut de le recommander comme économie pour Coden. Aucun upgrade n'a été effectué. [Conditions Hobby](https://vercel.com/docs/plans/hobby).

Firecrawl : la clé du service et le connecteur retournent 975 crédits restants, allocation 1 000, période 27 septembre–27 octobre. Différence de solde **25 crédits**, sous réserve des ajustements/grants ; ce n'est pas une facture. Cela correspond à l'allocation publique Free mais ne certifie pas un contrat ou des frais nuls. [Tarifs](https://www.firecrawl.dev/pricing), [API de solde](https://docs.firecrawl.dev/api-reference/endpoint/credit-usage).

Supabase, Resend, stockage, sauvegardes, logs, domaines, outils, paiements et bande passante : factures et quantités facturables non obtenues. Ces postes restent **non mesurés**, pas égaux à zéro. Les tarifs publics ne prouvent pas l'offre effectivement payée.

## 3. Contrats commerciaux à ne pas toucher

Catalogue FCFA legacy : Free 5 crédits une seule fois ; Pro à partir de 5 000 FCFA/25 crédits, palier 60 à 10 000 FCFA, puis 150 FCFA/crédit aux paliers supérieurs ; Business à partir de 30 000 FCFA/100 crédits et 300 FCFA/crédit. Annuel −20 %. Actions style 0,5 ; composant 0,9 ; plan 1 ; fonctionnalité 1,2 ; page complète 1,7. Emails inclus 1 000/5 000. Domaines Pro selon palier : 1, 3 ou 10, pas systématiquement 1. Business illimité. Niveaux essentiels/avancés/premium existants inchangés.

API publique `/api/billing/pricing`, **version 2** à la capture : Pro 20 USD / 12 000 FCFA, équivalent annuel 16 USD / 9 600 FCFA, 100 crédits mensuels + 5 quotidiens ; Pro+ 45 USD / 27 000 FCFA, annuel 36 USD / 21 600 FCFA, 250 + 5 quotidiens ; Business 40 USD / 24 000 FCFA par siège, annuel 32 USD / 19 200 FCFA, 100 + 5 quotidiens. Recharges Pro 0,25 USD/crédit et Pro+/Business 0,22, packs 50/100/250/500/1 000 ; grants Cloud 20, App AI 5. Aucun plafond mensuel des grants quotidiens indiqué dans cette configuration. L'API et le catalogue legacy diffèrent. **L'audit ne déclare pas quel parcours d'achat est contractuellement dominant et ne change aucun des deux.**

16 intentions de checkout consultées : 15 pending, 1 failed, 0 paid ; `billing_subscriptions_v2` vide. Cela ne prouve pas l'absence de ventes dans Saspay, une autre table ou un ancien parcours. Sans rapprochement, revenus nets/marges/TVA/litiges et taux de conversion Free sont inconnus.

Le flag `CODEN_MONETIZATION_V2_ENABLED` n'est pas configuré dans le service observé : facturation réelle désactivée dans ces parcours. La route historique `/projects/:id/messages` utilise alors un budget non mesuré et le niveau Enterprise ; lorsqu'elle est active elle lit encore un plan dans le body. **Risque de coût caché et d'étanchéité du plan à corriger avec une autorité serveur**, pas en basculant brutalement le flag. Le pipeline moderne lit le plan de l'organisation : ne pas généraliser la fuite à toutes les routes.

Le pipeline remplace un modèle manuel incompatible par Auto et supprime la sélection dans son catch. Ce comportement viole le contrat demandé ; le test de routage pur passe, mais **ne certifie pas le pipeline entier**. Correction séparée : conserver la sélection, expliquer la capacité manquante et proposer un changement explicite, jamais rétrograder silencieusement.

## 4. Économie et change

BEAC : 1 EUR = 655,957 XAF. Dernier cours BCE disponible lors de l'audit : **30 septembre 2026**, 1 EUR = 1,1355 USD ; conversion analytique 1 USD ≈ **577,6812 XAF**. Le taux commercial 600 du code reste inchangé. Le coût réel de carte/conversion peut différer. [BEAC](https://www.beac.int/en/faqs/), [BCE](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html).

Modèle paramétrable séparé de la facturation :

1. Revenu net = montant TTC/(1+TVA) − frais proportionnels sur le montant encaissé − frais fixes − remboursements nets − litiges nets.
2. Coût direct XAF = [IA USD×(1+frais d'acquisition des crédits fournisseur) + infra USD + services USD]×XAF/USD.
3. Marge brute = (net−direct)/net ; indisponible si net≤0. Coût fixe global séparé ; ne pas l'allouer puis le soustraire une seconde fois.
4. Revenu par crédit **émis** et par crédit **consommé** distincts ; crédits inclus/daily/rollover/recharges pris en compte. Ne pas diviser uniquement par les crédits consommés pour prétendre que tous les crédits offerts seront rentables.

Exemple de test, **supposé**, sans lien avec la TVA réelle d'un client : 12 000 XAF TTC, TVA 20 %, frais 3 %, AI 10 USD, change 600, infra/services/frais fixes de paiement/remboursements nuls → revenu net 9 640, coût direct 6 000, marge 37,76 %. Le cas est calculé à la main et testé. Les zéros sont des hypothèses explicites, pas des factures manquantes converties en zéros.

Proposition à valider : objectif 60 % de marge brute paid, alerte plancher 55 %. Ce sont des objectifs de gestion, **pas une marge actuelle ni un benchmark marché certifié**. Le code legacy contient déjà objectif 80 %, plancher 55 % et plafond Free 1 USD ; ne pas les activer/changer par cette tâche.

Exemple d'enveloppe **brute optimiste**, avant taxes/frais/infra, objectif 60 % : ancien Pro annuel 4 000/25 = 160 XAF/crédit → coût direct au plus 64 XAF, soit 0,11079 USD/crédit au cours analytique. Style 0,5 → 0,05539 USD ; page 1,7 → 0,18834 USD. Ce ne sont pas des plafonds opérationnels approuvés.

V3 Pro annuel sur un mois de 30 jours : 9 600/(100+150 daily)=38,4 XAF/crédit émis, avant grants Cloud/App AI et rollover ; à 60 % de marge, seulement 0,02659 USD de coût direct par crédit émis. La référence V3 0,144 USD/crédit et plafond 40 % (=0,0576 USD) ne suffisent donc pas à garantir la marge de cette offre à consommation totale. **Recommandation chiffrée, aucun tarif/crédit changé.**

Sensibilités proposées dans le simulateur : IA +20 %, USD/XAF ±10 %, consommation +50 %, volume Free×2. Un compte Free ne génère pas de revenu à lui seul : coût d'acquisition et coût récurrent doivent être couverts par les conversions et la contribution paid. Le coût par conversion reste inconnu.

## 5. Politiques des modes proposées — non activées

**Économique** : respecter la promesse existante « modèles les moins chers qui savent faire ». Contexte ciblé, cache stable, réutilisation, exploration sobre, arrêt des boucles déjà satisfaites ; pas de baisse arbitraire de raisonnement explicite ni de suppression de sécurité/QA. Objectif candidat : coût par tâche réussie ≤80 % d'Équilibré sur les mêmes tâches, réussite ≥95 %, qualité/design ≥85/100 selon barème existant, et aucune régression face à son propre baseline.

**Équilibré** : meilleur rapport qualité/prix ; routage par étape Auto, raisonnement adaptatif seulement en Auto, cache maximal, nombre de passages arrêté sur preuves. Objectifs candidats réussite ≥95 %, qualité ≥85/100, latences p50/p95 non dégradées. Le nombre de deux itérations n'est pas une décision appliquée : mesurer les exigences par route.

**Performance** : meilleure capacité sur étapes critiques, cache/contexte propres sans déguiser le mode en Équilibré ; contrôles complets et spécialistes si nécessaires. Réussite et qualité au moins égales à Équilibré, qualité candidate ≥90/100 ; si le gain n'est pas démontré, le signaler plutôt que modifier sa promesse. Aucun plafond arbitraire de quatre tours appliqué.

Pour chaque plan/palier/période : enveloppe = revenu net du crédit × crédits réellement attribuables × (1−marge cible) − coût infra/services de la tâche. Ajuster par p95/p99 mesurés, pas par moyenne globale. **Aucune valeur de plafond jour/mois/global proposée comme certaine** sans attribution des plans et des factures. Seuils d'alerte 70/90/100 testés en simulation, enforcement non relié à la production.

Les valeurs ci-dessus et la tolérance de bruit sont à valider par le propriétaire. Initialisation prudente : tolérance de régression zéro, pas d'activation automatique. Le jeu de 32 tâches est réutilisé dans les trois modes. Les 288 décisions de routage hors réseau valident des contrats de plan et de sélection ; elles ne mesurent pas la qualité réelle des modèles.

## 6. Optimisations classées et recommandations

Un classement financier exact `gain mensuel × confiance/(risque+effort)` est impossible avant mesure. Priorité qualitative provisoire, gains mensuels **non mesurés** :

1. Attribution/coûts/cache par tentative + provenance + rapprochement : préparation locale effectuée, risque faible, nécessaire pour toute décision.
2. Arrêt utilisateur réel, double appels, délais de retry annulables, runs interrompus/orphelins : inspecter les chemins durable SSE (une fermeture de tab n'est pas forcément une annulation). Le service OpenRouter gère déjà signal/deadlines/backoff ; préserver la reprise demandée par le produit. Gain = coûts des tentatives évitées, aujourd'hui non attribués.
3. Étanchéité du plan, modèle manuel non substitué, source serveur du plan et monétisation : risque/valeur élevés ; à corriger et tester pour tous les agents/replis avant activation. Aucun coût de crédit/menu modifié.
4. Cache stable et compaction ciblée : réutiliser l'existant, garder instructions/outils en tête et résultats variables en fin, ne jamais omettre la skill complète lorsqu'elle est requise par ses règles. Mesurer cache réellement déclaré, contexte/tokens par appel, relances et sortie utile.
5. Sous-agents/boucles : budget par mode/route, contexte minimal et diff, arrêt sur preuves ; pas de réduction de sécurité/qualité arbitraire.
6. Fournisseur du même modèle : aucun tri prix ni changement de fournisseur sans conformité qualité, latence, quantization et politique de données. Les requêtes actuelles exigent les paramètres mais ne fixent pas explicitement `data_collection:deny`/`zdr:true`. Paramètres de confidentialité du compte non inspectés : conformité **non démontrée**. Tester la disponibilité avant enforcement pour éviter une panne ; pas d'entraînement consenti pour obtenir une remise.
7. Lots non interactifs : candidat à mesurer pour modération/miniatures/résumés si déployés ; pas de génération de build interactive différée sans expliquer le contrat.
8. Previews/hébergement : cache de builds déterministes, images, statique/CDN, mesure actif/inactif/orphelins. Hibernation Coden déjà partiellement présente. Pas de purge/veille d'apps Free publiées, réduction de ressources, rétention ou migration DNS automatique.
9. Backend partagé : projet dédié supplémentaire Supabase Pro à partir de 10 USD/mois ; dix instances Micro additionnelles ≈100 USD/mois hors variables. **Projection de scénario**, pas dix projets payés confirmés. Mutualisation seulement après isolation/backup ; l'ancien chantier Runtime demeure séparé.
10. Comptes Free/abus : seuils réels observés puis propriétaires approuvés, pseudonymisation, détection de comptes multiples sans profils personnels dans le rapport. Ne pas retirer les cinq crédits ni modifier les offres.
11. Paiements : analyser pending/failed, webhooks idempotents, relances ; aucune transaction réelle ni modification de TVA/prix réalisée dans l'audit.

### Tarifs et contrats publics vérifiés le 1er octobre 2026

- OpenRouter Standard 5,5 %, Business 8 % de frais ; Enterprise annonce des remises de frais. BYOK Standard/Business : allocation sans frais jusqu'à 25 000 USD/mois de coût d'inférence au tarif catalogue, puis 5 %. Un compte direct/BYOK peut éviter jusqu'à 5,50 USD par 100 USD d'inférence vs Standard, avant autres coûts/conformité ; sur 13,213 USD de coût cumulé de clé, maximum théorique ≈0,73 USD, **pas un gain mensuel réalisé**. Aucun contrat/démarche ouvert. [Tarifs](https://openrouter.ai/pricing), [Enterprise](https://openrouter.ai/enterprise).
- Cache Anthropic : lecture variable selon modèle (10 % de l'entrée sur plusieurs modèles, moins sur certains), écriture 5 min 1,25× et 1 h 2× ; calculer le point mort et ne pas supposer chaque entrée réutilisable. Batch 50 % sur API standard, asynchrone, délai maximal documenté 24 h ; réservé aux tâches adaptées. [Cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- Le catalogue OpenRouter courant rapporte Kimi K3 entrée 0,28 USD/M tokens et lecture cache 0,27 : ~3,6 % d'économie sur les tokens lus, **pas 90 %**. Les tarifs conditionnels de long contexte doivent être conservés. Une estimation à partir du modèle catalogue n'est pas nécessairement le coût de l'endpoint effectivement servi. [API modèles](https://openrouter.ai/api/v1/models), [Schéma de tarifs](https://openrouter.ai/docs/guides/overview/models).
- Railway : RAM conteneur 10 USD/GB/mois, CPU 20 USD/vCPU/mois, egress 0,05 USD/GB. Builds de conteneurs gratuits ; ne pas leur attribuer fictivement une facture de compute distincte. [Tarifs](https://docs.railway.com/pricing/plans).
- Supabase Pro à partir de 25 USD/mois, 10 USD de crédits compute inclus, instances Micro additionnelles 10 USD/mois. Sauvegardes quotidiennes Pro incluses, pas Free. Ne pas économiser en perdant les sauvegardes. [Tarifs](https://supabase.com/pricing).
- Resend Pro : 20 USD/mois / 50 000 mails, dépassement 0,90 USD/1 000. Si tous étaient hors allocation, 1 000 et 5 000 mails coûteraient 0,90 et 4,50 USD en variable, **projection**, à ajouter à la part d'abonnement sans double comptage. [Tarifs](https://resend.com/pricing).
- Programme Railway Startup annoncé en 2024 avec critères de financement et 5 000 USD de crédits : vérifier l'éligibilité actuelle ; pas de droit acquis pour Coden et aucune candidature. Aucun montant de programme Supabase/OpenRouter non confirmé n'est promis. [Annonce officielle](https://railway.com/changelog/2024-04-26-startup-program).

## 7. Code préparé, activation et retour arrière

- `cost-observability.ts` : AsyncLocalStorage, scope résolu serveur, HMAC des identifiants, whitelists, coût déclaré/estimé/inconnu, cache/raisonnement/latence/résultat par tentative. Le raisonnement est un sous-ensemble de la sortie, jamais ajouté deux fois. Écriture asynchrone bornée, trois tentatives avec délai croissant, idempotence UUID ; pertes visibles dans les compteurs. Pas de garantie de complétude en cas de crash réseau/processus ; l'ancien registre de facturation reste séparé.
- `model-price-history.ts` : normalisation pure des prix de cache/raisonnement et conditions, sans writer ni deuxième table de prix. `model-price-sync.ts` étend le catalogue daté **existant** `provider_cost_catalog`, avec retour A→B→A distinct et notifier existant réutilisé. Les détails et leur alerte ne sont fournis que si le nouveau flag est activé. Le registre terminal `usage_events`, sa capture et le rapprochement existants restent distincts de la projection par tentative : pas de double addition. Le rapprochement existant à partir d'un delta de solde fournisseur n'est pas une preuve de rapprochement avec les factures.
- `cost-economics.ts` : modèle indépendant, inconnus restent inconnus, rapprochement de facture strictement même période, calcul manuel testé.
- `cost-optimization-gate.ts` : refus sans seuils approuvés, 30 tâches réelles appariées par mode, qualité/réussite/latence/coût et distinction des modes ; demande de rollback si régression. C'est une **porte logique préparée**, pas un contrôleur de canari/rollback branché au trafic.
- `server.ts` : flag `CODEN_COST_OBSERVABILITY_V1=1` nécessaire ; sinon aucune écriture d'observation. GET admin protégé, pagination/plafond/indication de couverture, aucune donnée personnelle retournée par cette projection. Plan/palier/période encore partiellement inconnus ; pas de fausse attribution.
- `admin-cost-observations.ts`, `admin-live.ts` : panneau observation dans l'onglet existant, masqué quand endpoint désactivé. Aucun nouveau menu modèle/mode/raisonnement, aucun changement des plans.
- Migration additive générée avec Supabase CLI : `20261001013421_coden_cost_observations.sql`. RLS activée, accès PUBLIC/anon/authenticated révoqué, serveur service_role select/insert uniquement. **Non appliquée**, permissions réelles non certifiées.

Journal des économies **appliquées en production : aucune**. Version locale `2026-10-01.observation-v1`. Gain mensuel réalisé : **non mesuré**, pas une extrapolation du test simulé.

Séquence suivante : déploiement du code flag off, sans migration → sauvegarde central → migration revue/essai staging → vérification SQL réelle des ACL/RLS → observation canari bornée après mesure du surcoût → rapprochement factures et tags → 32×3×2 essais réels avec budget/key dédiés → approbation des seuils/enveloppes → canari 5 % apparié et kill switch → élargissement seulement sans régression. Ne pas financer le benchmark avec le solde utilisateur. Aucun plafond contraignant activé sans accord.

Rollback observation : désactiver le flag puis revenir au commit précédent si nécessaire ; laisser les tables additives privées en place (ne pas supprimer de données). Routage actuel inchangé ; pas de migrations destructrices ni DNS.

## 8. Tests et reste à faire

Validation finale sur la base production `7955140` : **1 420 tests réussis, zéro échec sur 183 fichiers**. Contrat commercial normalisé uniquement pour les fins de ligne Windows/Linux, six empreintes source inchangées ; 288 décisions offline de plan/mode ; sélection explicite/reasoning inchangés dans le routeur pur ; test SSE simulé avant/après avec requête et réponse identiques ; confidentialité, inconnu ≠ zéro, cache déclaré, retrys bornés, catalogue daté réutilisé, marge calculée à la main, plafonds observation et rejet des manifestes invalides. Le validateur hors réseau exige les mêmes ≥30 tâches dans les trois modes et n'autorise jamais à lui seul une activation production.

TypeScript et build réussis après intégration. Contrôles supplémentaires `test-security-boundaries.ts`, `test-server-only-system-contract.ts`, `test-agent-harness-v3.ts` et `test-multi-agent-route-wiring.ts` réussis. La suite historique sur `97a6ac7` avait sept échecs reproduits sur cette baseline ; elle n'est plus le résultat actuel. Binaire FFmpeg de la dépendance verrouillée installé localement après l'installation sans scripts, sans changement du lockfile par cette tâche. Un échec intermittent du test Vercel a disparu en exécution isolée puis dans la relance complète. Aucun test existant n'a été modifié pour masquer un échec. Tests réels de modèle/fournisseur, captures avant/après qualité, permissions SQL réelles et rollback du trafic non validés.

Restent indispensables **avant toute activation d'économies ou de plafonds** : factures/export d'usage correspondant à la fenêtre (OpenRouter et historiques de clés, Railway, Vercel, Supabase, Resend/Saspay), taxes/frais réels, inventaire stockage/egress/emails/apps publiées, tags plan/palier/période/agents et résultats de tâches, volume/conversion Free, conformité des endpoints, contrôle de sélection manuelle/plan dans toutes les routes actuelles, budget benchmark et solde séparé, approbation des seuils puis vraie mesure avant/après. Le propriétaire a demandé le 3 octobre un déploiement du code d'observation **désactivé**, qui ne certifie pas ces validations et ne modifie ni routage ni crédits.

Réinvestissement possible **à décider** après économies réalisées : réserver 20 % des économies nettes mesurées à la capacité de preview/fiabilité, puis envisager un crédit d'usage ou moins de crédits par action après simulation de marge. Aucun prix ni coût en crédits réduit maintenant.

Le tableau problème/cause/correction/avant-après/reste, le classement et le simulateur figurent dans le canvas joint à l'audit. Ils distinguent explicitement mesures et hypothèses.
