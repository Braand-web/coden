# Audit Coden — 30 septembre 2026

Méthode : lecture du code (`server.ts`, `src/services/**`, `src/builder-live.ts`, pipeline multi-agents, harnais sandbox), requêtes en lecture seule sur la base de production (aucune valeur secrète lue), conseillers Supabase (sécurité et performance), exécution de la suite de tests sur `main` puis sur la branche, rendu réel du panneau d’historique dans Chromium (clair, sombre, 390 px).

Limite assumée : le bac à sable de cette session n’a pas accès aux CDN (`cdn.tailwindcss.com`, `esm.sh`, `unpkg.com`). Le rendu de l’aperçu dans un navigateur avec ces CDN n’a donc **pas** été observé ici. Il est couvert par des tests qui exécutent le script de configuration Tailwind réellement produit et vérifient le document ; la confirmation visuelle sur un projet de production reste à faire après déploiement (voir « Vérification après déploiement »).

## Chiffres de production (30/09/2026)

| Mesure | Valeur |
|---|---|
| Utilisateurs / projets / projets avec fichiers | 21 / 118 / 72 |
| Projets `verified` / `needs_fix` (parmi les 72) | 13 (18 %) / 59 (82 %) |
| Projets déployés (publiés) | 1 sur 118 (3 déploiements) |
| Tours d’agent : échoués / terminés / annulés / bloqués | 132 / 109 / 19 / 8 |
| Runs échoués par code | `RUN_INTERRUPTED` 79, `PROVIDER_TIMEOUT` 13, `MODEL_CAPABILITY_UNAVAILABLE` 6, `GENERATION_FAILED` 4, `PROVIDER_QUOTA_OR_BILLING` 3, `MODEL_OUTPUT_PARSE_FAILED` 3 |
| Projets avec un thème Tailwind qu’un aperçu « littéral » ne sait pas lire | 63 sur 72 (26 utilisent l’aide `tone()` du starter) |
| Aperçus enregistrés : page d’erreur / vides / rendu ancien | 18 / 16 / 38 (dont 17 erreurs « Unsafe file path blocked », défaut corrigé depuis) |
| Solde OpenRouter | presque épuisé (réponses réduites à ~5 000 tokens le 26/09) |
| `server.ts` / `builder-live.ts` | 21 710 / 9 326 lignes |

L’entonnoir dit l’essentiel : 118 projets créés, 72 avec des fichiers, 13 vérifiés, 1 publié.

---

## Ce qui est corrigé dans cette livraison

### Cause du problème 1 — le design disparaît après une itération

| Constat | Détail |
|---|---|
| Le design n’était défini nulle part de façon lisible par l’agent | Les jetons vivent dans `src/index.css`, la table de correspondance dans `tailwind.config.js`, la police dans `index.html`, et l’import du CSS dans `src/main.tsx`. Le pipeline actuel n’injectait **aucun** de ces éléments dans le contexte : `buildDesignTokenContext` n’était appelé que par l’ancien chemin, et `small_edit` ne recevait aucun contexte de design. |
| Rien n’empêchait de l’écraser | `write_file` remplaçait n’importe quel fichier. La liste « réservée » du starter (`tailwind.config.js`, `src/main.tsx`, `package.json`…) ne s’appliquait qu’à la toute première fusion, jamais pendant une itération. Réécrire `src/index.css` « pour ajouter une classe » supprimait chaque jeton lu par les autres composants. |
| `edit_file` corrompait certains remplacements | `String.replace` interprétait `$&`, `$1`, `$$` dans le texte inséré. |

**Correction.**

- `src/services/design-contract.ts` : le contrat de design (jetons globaux, clés du thème Tailwind, polices, import de la feuille de style, directives Tailwind) est extrait des fichiers, comparé, restauré et décrit en clair.
- Il est injecté pour **toutes** les routes d’itération, dans le prompt du planificateur, du codeur et des sous-agents (`multi-agent-pipeline.ts`).
- Écriture protégée (`sandbox-tools.ts`, aussi dans la boucle de réparation) : une écriture qui supprime un jeton, une clé de thème, une police ou l’import du CSS est **refusée avec un conseil actionnable** (utiliser `edit_file`). Changer la valeur d’un jeton n’est accepté que si la demande porte sur le look. Aucun jeton ne peut jamais disparaître, même pendant une refonte.
- Les fichiers du starter (`package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `src/main.tsx`, `ErrorBoundary.tsx`) ne peuvent plus être remplacés entièrement ; `edit_file` reste possible.
- Filet de sécurité en fin de run : tout ce qui manque encore est remis, **de façon additive** (les styles ajoutés par l’itération restent), avant toute sauvegarde. Chaque version enregistre l’empreinte du design avant/après.
- `edit_file` écrit désormais le remplacement littéralement.

### Cause du problème 2 — le design disparaît après actualisation ou réouverture

Les fichiers étaient bien sauvegardés (le CSS de NoteSpace est identique sur ses 7 versions). Ce qui perdait le design, c’est **la reconstruction de l’aperçu enregistré**.

| Constat | Détail |
|---|---|
| Thème Tailwind ignoré | `tailwindThemeLiteral` n’acceptait qu’un objet littéral et **refusait toute parenthèse**. Or la config du starter écrit `tone('--color-surface')` et `var(--radius-card)`. Résultat : aucune config n’arrivait à l’aperçu, `bg-surface`, `text-secondary`, `rounded-card` ne produisaient rien. Reproduit : la fonction renvoie `null` sur la config du starter. |
| Aperçus périmés jamais reconstruits | 17 projets affichaient « Preview indisponible — Unsafe file path blocked » pour un défaut de vérification corrigé depuis, 16 n’avaient aucun aperçu, 38 venaient d’un ancien moteur. |
| Ordre des modules | L’aperçu dépendait de l’ordre des fichiers (collation SQL vs système de fichiers), donc pouvait différer après rechargement pour le même contenu. |

**Correction.**

- `tailwindConfigScript` : la config du projet est **exécutée** dans l’aperçu (même confiance que le code de l’application, exécuté par Babel dans le même cadre isolé) ; imports et `require` deviennent inertes, TypeScript courant est toléré, le texte voyage comme chaîne JSON (aucune séquence ne peut fermer l’élément `<script>`), et un échec retombe sur le thème littéral. Le repli lui-même est maintenant échappé (il ne l’était pas).
- Version de rendu `theme-v2` : tout aperçu enregistré par un moteur plus ancien est reconstruit depuis les fichiers à la prochaine ouverture (uniquement si le code enregistré correspond aux fichiers, jamais pendant une itération interrompue).
- Une page d’erreur enregistrée, ou un aperçu manquant, alors que les fichiers existent : l’aperçu de l’auteur est reconstruit avec les vérifications actuelles. Un échec réel affiche le même document d’erreur honnête. Le public (production) n’est pas concerné.
- Rattrapage en arrière-plan 90 s après le démarrage (`refreshStaleSavedPreviews`, désactivable avec `CODEN_PREVIEW_REFRESH=0`) : réécrit uniquement `preview_html`, jamais les fichiers, le statut ni l’ordre du tableau de bord, et seulement si le projet n’a pas changé entre la lecture et l’écriture.
- Aperçu déterministe : fonction pure de l’ensemble des fichiers.

### Versions et retour arrière en un clic

| Constat | Détail |
|---|---|
| Le bouton « Rollback » échouait à chaque clic | Le serveur exige `confirmed: true`, le panneau ne l’envoyait jamais (409 systématique). |
| Aucun accès à l’historique | Le panneau n’apparaissait qu’après avoir écrit « rollback » dans le chat, et **n’avait aucun style** (bloc HTML brut). |
| Un retour arrière pouvait détruire l’aperçu | Si une vérification navigateur était insatisfaite, l’aperçu du projet restauré était remplacé par une page d’erreur. |
| L’état remplacé n’était pas conservé | Rien ne sauvait les modifications manuelles ni l’état courant avant restauration. |
| Le bac à sable gardait l’ancienne version | `writeFiles` ajoute et écrase, il ne supprime jamais : les fichiers d’une tentative abandonnée restaient et l’itération suivante repartait de « version enregistrée + restes ». |
| Numérotation et coût | `numéro = nombre de versions + 1` en téléchargeant chaque fichier de chaque version ; deux runs simultanés pouvaient écrire deux « version 4 ». |

**Correction.**

- Bouton **Historique** dans la barre du builder, panneau stylé (clair, sombre, mobile), une ligne par version : « Actuelle », « Vérifiée », « Non retenue », « Design modifié », nombre de fichiers.
- **Restaurer** est un seul clic, sans boîte de confirmation, car rien n’est perdu : l’état remplacé est enregistré comme version si aucune version ne le contient, et la restauration est elle-même une nouvelle version.
- Après chaque itération, une carte « **Annuler cette modification** » ramène à la version précédente.
- Le retour arrière reconstruit l’aperçu depuis les fichiers de la version (jamais une page d’erreur), resynchronise le bac à sable (`replaceProjectFiles`), et refuse de s’exécuter sous un agent en cours.
- Les itérations non vérifiées, qui laissent le projet sur sa dernière version fonctionnelle, sont marquées « Non retenue » et n’ont plus le statut « actuelle ».
- Numérotation lue depuis le plus haut numéro, index unique `(project_id, version_number)` (migration `20260930090000`, appliquée), relecture en cas de collision. La liste des versions ne renvoie plus les fichiers.
- Réouverture d’un projet : le bac à sable est rendu identique aux fichiers enregistrés (`exact`).

### Non-régression automatique

`src/services/design-persistence.regression.test.ts` rejoue toute la vie d’une application avec les vrais modules (starter thémé, outils du bac à sable, contrat, filet, aller-retour de persistance, rendu de l’aperçu) :

générer → itération « ajoute une page » (l’agent tente de remplacer la feuille de style) → itération « corrige le bouton » (il retire l’import du CSS et change une couleur sans qu’on le demande) → itération « change la couleur principale » (valeur modifiée, aucun jeton supprimé) → un fichier écrasé hors des outils (filet) → rechargement → fermeture puis réouverture → restauration de la version 1.

Après chaque étape : même empreinte de design, même aperçu octet pour octet, config Tailwind du projet exécutée et lue, chaque jeton présent dans l’aperçu rouvert.

Autres tests ajoutés : 17 sur le contrat, 6 sur la configuration Tailwind (config du starter, TypeScript, CommonJS, repli, échappement), 6 sur les outils du bac à sable (garde, protection du starter, `$&`, synchronisation exacte). Trois épingles textuelles de tests existants mises à jour (voir I3).

---

## Rapport priorisé

Effort : S ≤ 0,5 j · M ≈ 1–3 j · L > 3 j.

### Critique

| # | Défaut | Où | Impact | Correction | Effort | État |
|---|---|---|---|---|---|---|
| C1 | Thème Tailwind ignoré dans l’aperçu enregistré | `preview-embedding.ts`, `server.ts` (`buildReactVitePreviewHtml`) | 63/72 projets rouverts sans design | `tailwindConfigScript` | M | **Corrigé** |
| C2 | Une itération pouvait écraser jetons, config, import du CSS | `sandbox-tools.ts`, pipeline | Design perdu à chaque modification imprudente | Contrat + refus à l’écriture + filet | M | **Corrigé** |
| C3 | Retour arrière inutilisable et destructeur | `server.ts` (rollback), `builder-live.ts` | Aucun moyen d’annuler une itération ratée | Historique, restauration en un clic, annulation | M | **Corrigé** |
| C4 | Aperçus enregistrés périmés (18 erreurs, 16 vides, 38 anciens) | `server.ts` (`getProjectPreviewHtml`) | Cartes du tableau de bord et réouverture en « indisponible » | Reconstruction à la lecture + rattrapage | M | **Corrigé** |
| C5 | 82 % des projets en `needs_fix`, 79 runs `RUN_INTERRUPTED` | pipeline, vérificateur, déploiement | La promesse produit (une app qui marche) n’est tenue que pour 18 % des projets | PR #45 : faux échecs du vérificateur supprimés, drain 1 h, plancher de tokens | M | **Corrigé en partie** — à mesurer (voir roadmap 1) |
| C6 | Compte OpenRouter quasi vide | exploitation | Fichiers tronqués, aperçus cassés, échecs `PROVIDER_QUOTA_OR_BILLING` | Alertes et solde en admin (PR #45) ; **recharge à faire par vous** | S | **Action manuelle** |

### Important

| # | Défaut | Où | Impact | Correction | Effort |
|---|---|---|---|---|---|
| I1 | Deux moteurs de rendu : aperçu Babel + CDN d’un côté, build Vite réel de l’autre | `buildReactVitePreviewHtml` vs sandbox | Toute une classe d’écarts « ça marchait dans l’aperçu / ça ne marche pas publié » et l’aperçu enregistré dérive à chaque évolution de l’app | Enregistrer le `dist` du build réel (déjà produit par la validation) comme aperçu ; garder le moteur léger en secours | L |
| I2 | Observabilité des runs incomplète : `agent_runs.tokens_in/out/real_cost_usd` valent 0 pour tous les runs ; aucune vue du taux de succès | `server.ts` (règlement), admin | On ne voit pas si un correctif améliore ou dégrade la génération | Renseigner tokens/coût au règlement ; vue admin « santé des générations » (vérifié / needs_fix par route et modèle, délai jusqu’à l’aperçu) | M |
| I3 | Suite de tests fragile et sans CI : aucun workflow GitHub ; `npm test` rouge sur `main` (9 scripts : `test-multi-agent-route-wiring`, `-project-memory`, `-first-paint-is-stable`, `-project-card-ui`, `-dashboard-surface`, `-motion-and-skeletons`, `-acceptance-locators`, `-saas-performance`, `-multi-agent-pipeline` — ce dernier exige le Chromium de Playwright) ; un seul test e2e ; beaucoup de tests « épinglent » le texte de `server.ts` (3 ont cassé par un refactor sans effet) | `package.json`, `test-*.ts` | Une régression passe sans que personne ne le voie ; les tests freinent les refactors | GitHub Actions (tsc + vitest + scripts stables), remplacer les épingles par des tests de comportement, corriger ou supprimer les 9 scripts périmés | M |
| I4 | Aucun CSP ni `frame-ancestors` sur builder, tableau de bord, admin, auth | `server.ts` (middleware de durcissement) | Clic-jacking possible sur les pages authentifiées | `Content-Security-Policy: frame-ancestors 'self'` sur ces pages (les apps générées ont déjà leur CSP) | S |
| I5 | État en mémoire : sandboxes, limiteur de débit, runs actifs | `sandbox-registry.ts`, `RATE_LIMITS`, `activeAgentRunControllers` | Chaque déploiement supprime les aperçus vivants ; incohérent dès qu’il y a deux instances (Railway en recouvre pendant 60 s) | Redis (limiteur, registre de runs) ; instantanés E2B pour rouvrir sans réinstaller | L |
| I6 | Tableau de bord : `preview_html` complet de chaque projet dans la liste | `enrichProjectsForDashboard` | Jusqu’à ~1 Mo pour un utilisateur de 25 projets, croît avec chaque projet | Miniature générée à la vérification, HTML chargé à la demande | M |
| I7 | Les secrets sont masqués au chargement puis le projet est réécrit masqué | `loadProjectFiles`, `redactSecrets` | Une valeur ressemblant à `token: '…24+ caractères'` est remplacée par `[masked-secret]` dans le code de l’utilisateur, sans avertissement | Masquer pour le modèle et les journaux seulement, jamais pour la persistance ; avertir à la génération | M |
| I8 | Protection contre les mots de passe compromis désactivée | Supabase Auth | Comptes exposés aux mots de passe déjà fuités | Activer dans Auth → Mots de passe (réglage du tableau de bord Supabase, pas de SQL) | S |
| I9 | Monolithes : `server.ts` 21 710 lignes, `builder-live.ts` 9 326 | ensemble | Tout changement touche tout ; les épingles de test cassent | Découper en routeurs et services, module par domaine | L |
| I10 | 62 erreurs avalées (`catch {}`, `.catch(() => null)`) dans `server.ts` | ex. création de version | Une version perdue ou une sauvegarde manquée passe inaperçue | Journal structuré + compteur, ne taire que ce qui est vraiment optionnel | S–M |
| I11 | `agent_harness_events` : 33 405 lignes pour 268 tours (~125 par tour), sans rétention | schéma harnais | Croissance linéaire, requêtes de relecture de plus en plus lentes | Rétention (90 j) ou partitionnement, agrégation des événements bavards | S |
| I12 | Coût des échecs non refacturé : 0,109 $ en moyenne par création ratée (max 0,46 $) | pipeline | Marge érodée tant que le taux d’échec reste élevé | Arrêt anticipé quand la même erreur revient (déjà : 3 tours sans progrès) ; plafond de coût par run | S |
| I13 | Limiteur de débit en mémoire et par route | `RATE_LIMITS` | Pas de protection homogène (connexion, création de projet) ; contournable avec plusieurs instances | Limiteur partagé (voir I5) sur connexion, création, génération | M |
| I14 | Réservations de crédits jamais libérées après un run interrompu : 2 réservations `reserved` datent de 21 et 22 jours (expirées depuis 30 min après leur création), chacune retient 1 crédit d’un abonné | `usage_reservations`, `usage_reservation_lines` | Chaque run tué en cours de route peut retenir des crédits pour toujours ; aucun ménage n’existe côté serveur ni en base | Tâche périodique qui libère les réservations expirées (décision produit : restitution automatique). Je n’ai **pas** modifié ces deux lignes de production | S |
| I15 | Comptes et paiements non audités ici | auth Google, Stripe/Saspay | — | À faire : vérifier le fournisseur Google dans Supabase et la question du compte Stripe en attente | S |

### Amélioration

| # | Idée | Où | Bénéfice | Effort |
|---|---|---|---|---|
| A1 | Barre de navigation du builder faite de `span role="button"` | `builder.html` | Accessibilité clavier ; vrais `<button>` | S |
| A2 | Doublon d’index (`project_messages`), 55 clés étrangères sans index, 55 politiques RLS réévaluées par ligne, 42 index inutilisés | base | Sans effet à 21 utilisateurs, à traiter avant la croissance | S |
| A3 | `getUserOrgId` renvoie l’identifiant utilisateur | `server.ts` | Nom trompeur, source de confusion organisation / utilisateur | S |
| A4 | Bloc « design » de ~3 500 tokens + contrat envoyés à chaque tour | pipeline | Coût en tokens ; mise en cache du préfixe stable | S |
| A5 | 82 % de projets « À corriger » | tableau de bord | La pastille ambre devient du bruit ; distinguer « à corriger » de « non vérifié » | S |

---

## Agents

- **Qualité et cohérence entre itérations.** Le point faible était l’absence de contrat de design (corrigé). Reste : aucune spécification produit persistée ; la mémoire de session (`session-context`) et les décisions (`project_memory`, 47 lignes `adr`) couvrent le « pourquoi » mais pas la structure des écrans. Voir roadmap 5.
- **Mémoire.** `project_memory` contient 23 lignes `design_token` écrites par l’ancien chemin uniquement ; elles ne sont plus lues par le pipeline actif et peuvent être retirées. `agent_error_memory` fonctionne (75 lignes).
- **Prompts.** Le prompt système du codeur est dense et cohérent (lots d’outils, lecture avant édition, pas de dev server). Le contrat ajoute ~1 000 à 1 500 tokens sur toutes les routes, y compris `small_edit` : il est stable d’un tour à l’autre, donc à mettre en cache (A4).
- **Boucles et erreurs.** Détection de stagnation (3 tours), échéance par route (3 / 8 / 11 min), escalade Auto (raisonnement puis modèle). Un refus d’écriture consomme un appel d’outil : surveiller `[coden:design_write_refused]` ; si une même itération en cumule beaucoup, la formulation du conseil est à revoir.
- **Coût et vitesse.** `usage_events` ne contient **aucune** exécution de build réussie (22 lignes, toutes `*_failed` : création ≈ 0,11 $ en moyenne, grosse modification ≈ 0,04 $, petite ≈ 0,015 $). Soit le règlement des réussites ne s’écrit pas, soit elles sont très rares : dans les deux cas c’est à vérifier en premier (roadmap 1). Le facteur dominant reste le taux d’échec, pas le prix par run.

## Harnais

- **Outils.** Complets (fichiers, recherche, commandes bornées, installation avec `--ignore-scripts`, web, intégrations). Manquait : une politique sur les fichiers d’identité du projet (ajoutée). `write_file` ne pose pas de limite de taille par fichier : à vérifier.
- **Fichiers et exécution.** `writeFiles` seulement additif (corrigé par `replaceProjectFiles` à la réouverture, à la restauration et au démarrage d’une itération). Sandbox E2B isolée en production ; bac à sable hôte conditionné par `CODEN_SANDBOX_ISOLATION`.
- **Reprise.** `resume-brief`, instantané durable pendant le run (`onSnapshot`), réparation avec outils. Le maillon faible était le déploiement (79 runs interrompus) : drain porté à 1 h.
- **Journaux.** Événements d’agent durables et ordonnés (bon), mais journaux applicatifs en texte libre et sans corrélation systématique `runId` / `requestId` (I10, roadmap 1).
- **Tests.** 98 fichiers vitest, tous verts (671 tests) ; chaîne `npm test` rouge sur `main` (I3).

## Expérience utilisateur

- **Parcours.** Création → génération → aperçu → publication : 118 → 72 → 13 → 1 projet. Les deux plus grosses pertes sont la génération qui ne se vérifie pas (C5) et le passage de « vérifié » à « publié » (aucune donnée pour l’expliquer : à instrumenter).
- **Frictions corrigées ici.** Pas d’accès à l’historique ; retour arrière qui échoue ; aperçu « indisponible » sur des projets intacts.
- **États de chargement et d’erreur.** L’historique affiche « Chargement… », une erreur explicite et un état vide utile ; l’annulation propose l’action au lieu d’un avertissement.
- **Responsive.** Le panneau d’historique a été rendu à 390 px (une colonne, bouton sous la description). Le reste du builder n’a pas été rejoué en mobile dans cet audit.

## Performance, sécurité, fiabilité

- **Sécurité.** Bon : HSTS, `nosniff`, politique de référent, CSP `sandbox` sur les apps générées, jetons d’aperçu, `--ignore-scripts`, RLS activée sur les 100+ tables (35 sans politique, ce qui correspond à un accès réservé au service). À corriger : I4 (CSP des pages authentifiées), I7 (masquage persistant), I8 (mots de passe compromis). Les indicateurs d’accès temporaire (`CODEN_TEMPORARY_GENERATION_*`) doivent rester éteints en production ; leur mode « faire confiance à `X-Forwarded-For` » ne doit être activé que derrière un proxy de confiance.
- **Performance.** I6 (charge du tableau de bord), I11 (événements), A2 (index).
- **Fiabilité.** I5 (état en mémoire), I9 (monolithes), C5 (taux de vérification).

---

## Roadmap, classée par impact

1. **Mesurer et tenir le taux de génération vérifiée** (I2, I10) : tableau de bord santé, objectif > 70 % de projets vérifiés, alerte si le taux chute. Sans mesure, on corrige à l’aveugle. *Impact très élevé, M.*
2. **Aperçu = build réel** (I1) : enregistrer le `dist` du build Vite comme aperçu. Supprime la dérive entre aperçu et production et rend le design identique à la publication. *Impact très élevé, L.*
3. **Panneau Design** dans le builder : palette, typographie, arrondis, mode clair/sombre modifiant directement les jetons, sans passer par le modèle (déterministe, gratuit, ne peut pas casser le reste). Il s’appuie sur le contrat et sur la restauration. *Impact élevé, M.*
4. **Diff visuel par itération** : captures avant/après (Playwright déjà présent), comparaison, alerte « le design a changé » dans la carte d’annulation. *Impact élevé, M.*
5. **Spécification produit persistée** (`PRODUCT.md` : écrans, parcours, données) lue par chaque itération, pour la cohérence fonctionnelle comme le contrat l’assure pour le visuel. *Impact élevé, M.*
6. **Entonnoir publication** : instrumenter vérifié → publié (1 projet sur 118 aujourd’hui) et lever le premier frein constaté. *Impact élevé, M.*
7. **CI et tests de comportement** (I3) : GitHub Actions, remplacer les épingles textuelles, un e2e « générer → itérer → recharger » contre un modèle simulé. *Impact moyen, M.*
8. **Multi-instance** (I5, I13) : Redis pour limiteur et registre de runs, instantanés de sandbox. *Impact moyen, L.*
9. **Miniatures du tableau de bord** (I6). *Impact moyen, M.*
10. **Découpage de `server.ts` et `builder-live.ts`** (I9), avec les tests de comportement de l’étape 7 comme filet. *Impact moyen à long terme, L.*

## Vérification après déploiement

À faire sur un projet réel dont le design était perdu (par exemple NoteSpace, ClientFlow) :

1. Ouvrir le projet : l’aperçu doit être stylé (thème, polices, arrondis). La ligne `[coden:saved_previews_refreshed]` apparaît dans les journaux Railway environ 90 s après le démarrage.
2. Demander une modification sans rapport avec le look (« ajoute une page de facturation ») : l’empreinte de design doit rester identique (`design.before === design.after` dans la version) ; toute tentative de réécrire la feuille de style apparaît dans `[coden:design_write_refused]`.
3. Ouvrir **Historique**, restaurer une ancienne version, puis « Annuler » : fichiers, jetons et aperçu reviennent exactement.
4. Recharger, fermer et rouvrir l’onglet : même rendu.
