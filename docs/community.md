# Communauté — carte de l'existant, règles, hypothèses, bilan

Fonctionnalité derrière `CODEN_COMMUNITY` (désactivée par défaut). Retour arrière : retirer la variable (l'entrée de la barre latérale et toutes les routes disparaissent), ou, sans redéploiement, « Masquer toute la Communauté » dans Admin → Communauté. Aucune table existante n'est modifiée (migration additive `20261001000000_community.sql`).

## 1. Carte de l'existant et ce qui a été réutilisé

| Domaine | Existant dans Coden | Réutilisé / adapté |
|---|---|---|
| Barre latérale | `Sidebar` de `src/dashboard-react.tsx`, routes par hash (`#suggestions`) | Entrée « Communauté » sur le même modèle, routes `#community…`, page chargée à la demande |
| Design | Tokens `coden-tokens.css`, `canonical-shell.css` (`coden-ui-skeleton`), onglets/pastilles de Suggestions | Tokens uniquement, squelette partagé, aucun violet, animations transform/opacité |
| Publication | `publishVercelProjectForRequest` → `deployments` (staged→ready, `public_url`, `commit_hash`) + `publications` | Hook en arrière-plan après succès : peut retarder un listing, jamais bloquer la publication |
| Versions | `project_versions.files_snapshot` | Source du snapshot publié quand une app est ajoutée après coup |
| Plans | `free / pro / business / enterprise` (`billing-v2.ts`, `organizations.plan`) | Mapping gratuit/payant dans `visibility.ts`, un plan inconnu est traité comme payant (prudence) |
| Changement de plan | `SaspayService` (activation, rétrogradation) | Crochet `setPlanChangeHook` (sans effet sur la facturation) |
| Modèles de départ | `starters.ts` (échafaudages techniques, pas de galerie) | Détection « modèle non modifié » ; templates officiels = briefs lancés dans le flux de création existant |
| Auth / droits | `requireAuth`, `requireAuthenticatedUser`, `loadProject` | Toutes les routes derrière connexion, sauf miniature et page partageable |
| Limitation | `enforceRateLimit` | Par route et par compte |
| Admin | onglets `admin-live.ts`, `requirePlatformAdmin`, `recordAdminAudit`, `adminMutationAllowed` | Onglet « Communauté », mêmes garde-fous et journal d'audit |
| Alertes / e-mails | `admin-alert-notifier` (Resend) | E-mails aux créateurs via la même clé Resend |
| Navigateur | Playwright + Chromium (nixpacks), `sharp` | Inspection de la page publique et miniature WebP |
| Scan de secrets | `secret-redaction.ts` (distingue JWT anon / service_role) | Réutilisé, étendu aux clés de fournisseurs courants |
| Fichiers | Supabase Storage | Bucket privé `community-thumbs`, servi avec cache long |
| Drapeaux | variables d'environnement lues au démarrage | `CODEN_COMMUNITY` + 2 interrupteurs en base (masquer, geler) relus toutes les 15 s |
| Propositions | `agent_proposals` (cartes qui renvoient un prompt à l'agent) | Non adapté : l'offre « Ajouter à la communauté ? » n'est pas un prompt ; elle est dans le panneau de publication |
| Protection d'accès | aucun concept de mot de passe / accès privé sur les apps publiées | La règle l'accepte en entrée (`protection`) et ne liste jamais ; l'entrée est `none` tant que cette fonction n'existe pas |

## 2. Règles de visibilité telles qu'appliquées (`src/services/community/visibility.ts`, une seule fonction)

```
retirée par la modération ──────────► jamais listée (jusqu'à levée par un admin)
retirée par le créateur ────────────► jamais listée
non publiée (brouillon/dépubliée) ──► jamais listée
protégée (mot de passe/privé) ──────► jamais listée
plan gratuit ───► listée après contrôles   (sauf préavis de 14 jours après une rétrogradation)
plan payant  ───► listée seulement si « Ajouter à la communauté » est activé
plan inconnu ───► traité comme payant
gel des nouveaux listings ──────────► n'empêche pas ce qui est déjà en ligne
```
Chaque décision a un `code` stable et une raison en français, inscrits dans `community_moderation_events` (qui, quoi, pourquoi, quand). La règle est re-demandée au moment du contrôle : un changement de plan ou une dépublication entre-temps l'emporte.

États : en contrôle · en ligne · à corriger · refusé · retiré par l'utilisateur · retiré par la modération · masqué (le temps d'un examen).

## 3. Contrôles avant listing (pipeline asynchrone, jamais dans la publication)

Technique (adresse publique, rendu non vide, erreur de page) · sécurité (clés privées dans le code livré au navigateur, source **et** fichiers reçus ; clé publique Supabase/Stripe non confondue ; code masqué, mineur, redirections) · modération (filtre de mots, puis modèle de vision seulement en cas de doute ; usurpation de marque sur page de connexion) · vie privée (e-mail/téléphone du titre et de la description refusés ; flous sur la miniature) · qualité 0–100 (rendu, accessibilité, système de design, contenu) · doublon (simhash 64 bits) · anti-abus (plafond par compte, période d'observation des comptes récents, sanctions graduées).
Republication : l'ancienne version reste affichée jusqu'à validation ; en cas d'échec mineur/majeur on garde la dernière version validée, en cas d'échec critique (secret, code malveillant, modération) l'annonce est retirée.

## 4. Hypothèses et valeurs par défaut (à ajuster)

1. Apps gratuites remixables par défaut ; le remix ne coûte aucun crédit (les modifications ultérieures consomment normalement).
2. **Crédits bonus au créateur remixé : non implémentés.** L'octroi de crédits a un effet financier réel et doit rester dans les plafonds de coûts ; le drapeau `CODEN_COMMUNITY_BONUS` est réservé mais ne fait rien.
3. Période d'observation d'un compte récent : 6 h (`CODEN_COMMUNITY_PROBATION_HOURS`), 3 apps max pendant ce temps ; plafond 30 apps visibles par compte.
4. Masquage automatique : 3 signalants distincts (2 pour les motifs graves) ; ré-analyse renforcée (un doute sans modèle compte contre l'app) ; levée automatique si la ré-analyse ne trouve rien.
5. Sanctions : avertissement, puis 7 jours de suspension des ajouts, puis exclusion de la Communauté ; l'app et le compte ne sont jamais touchés.
6. Rétrogradation payant→gratuit : préavis de 14 jours par e-mail et bandeau, puis ajout automatique des apps publiées gardées privées. Passage gratuit→payant : les apps déjà listées restent listées jusqu'au choix du propriétaire.
7. « Publiée » = dernier déploiement prêt **et** pointeur `publications` présent (la dépublication actuelle supprime le pointeur et laisse le déploiement).
8. Les fichiers publiés d'une app ajoutée après coup sont reconstruits depuis l'historique de versions (dernier état enregistré avant la publication).
9. Templates officiels = briefs envoyés à l'agent (aucun fichier de template n'existait) ; le test de build/parcours/score design est à lancer, `design_score` reste vide d'ici là.
10. Défilement infini : pagination par curseur + `content-visibility: auto` plutôt qu'un fenêtrage JavaScript.
11. Les apps affichées sont servies depuis le domaine d'hébergement des apps (distinct de coden.fun), dans un `iframe` `sandbox="allow-scripts allow-forms allow-popups"` sans `allow-same-origin`, chargé au clic, sans référent.

## 5. Ce qui n'est pas fait ou à valider

- Crédits bonus (point 2).
- Suppression de compte : aucune route n'existe dans le dépôt ; `purgeUser()` est prêt à y être branché.
- Test de bout en bout contre une vraie base Supabase et des mails réels : non fait dans cette session (flux testés avec une base simulée, un vrai navigateur et la migration validée en transaction annulée).
- Modèle de vision : branché mais non exercé (pas de crédit OpenRouter) ; sans lui, les cas douteux sont listés sans mise en avant.
- CGU, mentions à l'inscription et procédure de retrait : rédigées mais **à faire valider par un juriste**, RGPD compris. Adresse de contact utilisée : contact@coden.fun.
- Mesures de performance (60 fps, temps de chargement de la grille) non faites sur données réelles : la grille est vide en production tant que le drapeau est coupé.
- Le contrôle de la période de 14 jours et les e-mails n'ont pas été éprouvés avec un vrai changement de plan.

## 6. Problème → cause → correction

| Problème | Cause racine | Correction | Avant / après | Reste |
|---|---|---|---|---|
| Colonne `tsvector` refusée par Postgres | `array_to_string` n'est pas immuable | Recherche plein texte sur titre + description, tags hors vecteur | migration refusée → validée | recherche par tag non indexée |
| Numéro de téléphone lisible dans la miniature | le floutage ne traitait qu'une occurrence par texte | une passe qui floute tous les e-mails et téléphones | 1/2 flouté → 2/2 (contrôle automatique dans la vérification) | formats de numéros exotiques |
| Identifiant de compte exposé via le profil public | l'identifiant servait de lien de profil | identifiant public dérivé (hachage) | fuite → aucune (test) | pages de profil non construites |
| Mauvaise lecture « plus mis en avant » dans la vérification | critère de qualité au lieu du verdict | critère = verdict de mise en avant | 32/34 → 34/34 | jeu de test écrit par l'auteur des règles |

## 7. Évolutions possibles (non implémentées)

Commentaires · suivre un créateur · collections · concours · marketplace de templates payants · proposer une app comme template officiel · badge « Fait avec Coden » avec lien retour sur les apps du plan gratuit · pages de profil créateur · crédits bonus plafonnés.
