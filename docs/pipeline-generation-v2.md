# Pipeline de génération — diagnostic et restructuration

## Résumé

La génération échouait sur des pannes **transitoires et parfaitement récupérables**.
La machinerie de retry et de fallback existait, était complète, et ne se
déclenchait presque jamais : le classificateur d'erreurs se trompait de verdict.

Trois défauts, du plus grave au moins grave.

---

## Défaut 1 — le classificateur lisait les status codes dans du texte libre

`ProviderGateway.classifyError` décidait si une panne valait un nouvel essai en
faisant tourner des expressions régulières sur le **message** de l'erreur. Les
motifs étaient des sous-chaînes non ancrées.

| Erreur réelle du provider | Motif qui matchait | Verdict rendu | Vérité |
|---|---|---|---|
| `HTTP 503: upstream timeout after 40000ms` | `/400/` sur `40000` | `PROVIDER_BAD_REQUEST`, non-retryable | transitoire |
| `HTTP 500: internal error (req 8402331)` | `/402/` sur `8402331` | `PROVIDER_QUOTA_OR_BILLING` — « crédits insuffisants » | transitoire |
| `HTTP 529: overloaded, retry after 4029ms` | `/429/` sur `4029` | rate-limit (bon réflexe, mauvaise raison) | surcharge |
| `HTTP 502: no response in 14000ms` | `/400/` sur `14000` | `PROVIDER_BAD_REQUEST` | transitoire |
| `fetch failed: ECONNRESET after 24004 bytes` | `/400/` sur `24004` | `PROVIDER_BAD_REQUEST` | réseau |

Conséquences en chaîne :

- `retryable: false` → le gateway `throw` immédiatement : **ni retry, ni fallback**.
- L'utilisateur lisait « crédits insuffisants » pendant qu'un HTTP 500 passait.
- Le disjoncteur (`circuits`) était alimenté avec de fausses catégories.

**Après.** Les erreurs HTTP portent leur status (`ProviderHttpError`), et le
verdict se lit dessus. `isRetryableStatus` : 408, 409, 429 et tout 5xx sont
retryables ; le reste des 4xx ne l'est pas. Les motifs textuels subsistants ne
contiennent plus aucun numéro de status, et un test le vérifie.

---

## Défaut 2 — annulation et timeout étaient le même événement

Les deux remontaient en `AbortError`, et le classificateur lisait les deux comme
un timeout — donc `retryable: true`.

**Avant.** L'utilisateur appuie sur Stop → le gateway réessaie → en mode Auto, il
bascule sur un second modèle. Deux appels facturés pour une demande d'arrêt.

**Après.** `ProviderCancelledError` et `ProviderTimeoutError` sont distincts et
levés à partir de `signal.aborted`. Une annulation vaut `REQUEST_CANCELLED`,
non-retryable, sans fallback. Un timeout reste exactement ce pour quoi les
retries existent.

---

## Défaut 3 — les streams n'avaient aucun retry

`streamChat` ne réessayait jamais le même modèle : la boucle ne passait qu'au
modèle **suivant**, et seulement si l'appelant avait activé le fallback. Un
modèle épinglé qui prenait un 502 tuait la génération, avant même qu'un token
n'atteigne l'écran.

**Après.** `streamAttempts` réessaie tant que **rien n'a été émis**. Dès le
premier token, plus aucun retry : relancer un stream déjà partiellement rendu
rejouerait les tokens, et rien en aval ne distingue le doublon de l'original.

Défaut annexe dans `OpenRouterService.chat` : la boucle `retryAttempts = 3`
abandonnait sur `AbortError`, donc un timeout — le cas transitoire le plus
courant — n'était **jamais** réessayé, alors qu'un HTTP 400 l'était trois fois.
Les deux sont inversés.

---

## Sélection de modèle

**Avant.** Cinq listes de préférences codées en dur dans `ModelRouter`
(`Fast`, `Balanced`, `Pro`, `Premium`, plus `selectBestAutoModel`), une fonction
de score pondérée, et une sixième liste pour le juge. Toutes répondaient à la
même question et pouvaient diverger : `Balanced` préférait un modèle que le
chemin Auto de même complexité classait quatrième.

**Après.** Un seul fichier : `src/services/model-selection.ts`. Une règle :
**le modèle le moins cher qui reste capable pour cette tâche**.

- Le catalogue est parcouru par coût croissant (mélange 25 % entrée / 75 % sortie).
- Chaque tâche déclare une barre de compétence ; la complexité déplace la barre.
- Le premier modèle qui franchit toutes les portes (plan, crédits, latence,
  capacités, fenêtre de contexte) est retenu.
- Chaque décision transporte ses rejets et leur motif : un routage inexplicable
  est un routage incorrigible.

Un mode n'est plus qu'un plancher de complexité. Il ne peut plus nommer un modèle.

**Effet mesuré** (voir `test-model-selection.ts`) : le routage d'intention part
sur le modèle le moins cher du catalogue même sur un plan Enterprise ; une tâche
d'architecture prend le raisonneur *frontier* le moins cher, pas le plus cher.

---

## Catalogue

Réduit de 11 à 9 modèles. DeepSeek V4, Qwen3.8 et GLM-5.3 sont retirés.

Les modèles retirés sont **désactivés, pas supprimés** en base
(`20260903120000_restrict_ai_model_catalog_to_authorised_nine.sql`) : les projets
existants portent une clé étrangère vers leur modèle, et un projet généré le mois
dernier doit continuer à dire avec quoi il a été construit.

Les migrations historiques ne sont pas réécrites — elles ont déjà tourné en
production, et modifier une migration appliquée désynchronise tout environnement
qui en a enregistré la somme de contrôle.

---

## Interface de progression

**Avant.** L'ancien streaming avait été retiré en laissant trois marqueurs
`[REMPLACEMENT STREAMING UI ICI]` et des fonctions vides :

- `setMessageShimmer` écrivait son libellé dans `liveRun.activeText` — que rien
  ne rend. Le shimmer lit `view.publicActivity`. Le panneau restait donc **vide**
  entre l'envoi et le premier événement serveur.
- `appendToMessageShimmer` était un stub vide : sans l'îlot React, la réponse du
  modèle était intégralement jetée.
- Un site d'appel passait `''` comme libellé.

**Après.** Le libellé alimente l'état que le shimmer dessine, avec `sequence: 0`
pour qu'un vrai événement serveur le remplace toujours sans course. `clearWorking`
éteint l'animation : un shimmer qui continue après la fin du run est l'interface
qui ment sur le backend.

Le texte affiché est la **phase courante du run** (`understanding`, `planning`,
`building`, `testing`, `fixing`, …), déjà émise par le pipeline en FR et EN. Elle
change quand le serveur dit qu'elle change — jamais sur un minuteur. Un cycle de
phrases toutes les 3 secondes ne peut pas se tromper parce qu'il ne mesure rien :
il s'affiche à l'identique que le backend travaille, soit bloqué, ou ait fini.

Les noms de modèles restent hors de l'interface : le contrat de la plateforme
interdit d'exposer les mécaniques internes (routage, fallback, modèle retenu).
Ce qui est montré est le rôle et l'étape, pas le fournisseur.

---

## Où la sélection est appelée

| Site | Avant | Après |
|---|---|---|
| `ModelRouter.selectModel` | 5 listes codées en dur + score pondéré | délègue à `selectModel` |
| `ModelRouter.selectJudgeModel` | 6ᵉ liste codée en dur | `selectModel({ task: 'review' })` + contrainte d'indépendance |
| `classifyIntentWithAi` (server.ts) | `DEFAULT_PROVIDER_MODEL_ID` en dur | `selectModelForAgent('router', …)` |
| `/api/ai/route` | `ModelRouter` | inchangé — passe par le routeur, donc par le sélecteur |

Un test (`test-model-selection.ts`) échoue si une liste de préférences de modèles
réapparaît dans le routeur.

## Tests

| Fichier | Couvre |
|---|---|
| `test-provider-error-classification.ts` | les 5 pannes mal classées, l'annulation, la règle de retry, et la non-réapparition des motifs numériques |
| `test-pipeline-resilience.ts` | retry sur transitoire, fallback sur modèle absent, retry sur timeout, **aucun** retry sur annulation, échec rapide sur 400, retry de stream avant le 1ᵉʳ token et jamais après |
| `test-model-selection.ts` | pool = 9 autorisés, ordre par coût, tâche simple → modèle le moins cher, tâche dure → le moins cher *capable*, portes plan/crédits/latence/capacités, décision explicable, zéro liste dupliquée |
| `test-pipeline-shimmer.ts` | aucun minuteur, le texte suit les phases réelles via le vrai réducteur, s'éteint à la fin, les stubs sont partis |
| `src/config/ai-models.test.ts` | catalogue épinglé aux 9, prix cohérents, fallbacks dans le catalogue |

Chacun des trois tests de correction a été vérifié contre l'arbre pré-correctif
et y échoue avec le message qui nomme le défaut.

## Limite connue

Les prix et les identifiants des 9 modèles n'ont **pas** pu être confirmés contre
le catalogue OpenRouter en direct : `openrouter.ai` est bloqué (403) par le proxy
de cet environnement. Les tarifs sont repris des équivalents existants du
catalogue, avec une remise appliquée aux tiers `:batch`. Ils gouvernent l'ordre
de sélection, donc **à vérifier contre la facturation réelle** avant de s'y fier
pour des décisions de coût.
