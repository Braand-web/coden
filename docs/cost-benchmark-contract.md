# Contrat d'essais de coûts — aucune activation

Ce validateur hors réseau prépare la comparaison de Coden. Il ne lance aucun appel payant, n'active aucun flag, ne change pas le routage et ne déploie rien. Les prix et menus de production restent inchangés.

Commande depuis le dépôt, Node 22+ :

```powershell
node --experimental-strip-types scripts/evaluate-cost-benchmark.mjs --before PRIVATE_BASELINE.json --after PRIVATE_CANDIDATE.json --policy PRIVATE_APPROVED_POLICY.json
```

Conserver les entrées privées hors Git. Le contrat refuse les champs inconnus, y compris prompts, réponses, emails et identifiants personnels. Seuls les identifiants synthétiques du jeu versionné `evals/reference-set.json` sont acceptés.

Chaque manifeste possède exactement `schemaVersion` (1), `referenceVersion` (1), `measurementKind` (`live`), `deploymentCommit` (SHA Git complet), `plan` (free/pro/pro_plus/business), `rows`. Les manifestes avant et après concernent le même plan et le même jeu.

Chaque ligne possède `taskId`, `mode` (economy/balanced/performance), `success`, `quality` (0–100), `latencyMs`, `costUsd`, `realExecution` (true), `costSource` (gateway), `iterations` et `errors` (entiers). Une ligne représente **toute une tâche**, pas un appel : sommer les coûts réels de tous les agents, tentatives échouées et vérifications ; le délai va du début à la fin de la tâche. Le coût par tâche réussie inclut aussi les dépenses des tâches échouées. Les nombres ne sont pas des estimations ni des lignes de routage offline.

Le score qualité doit provenir du même barème indépendant avant/après. `success` correspond aux assertions fonctionnelles de l'app, pas à une simple réponse HTTP. `errors` compte les erreurs pendant la tâche ; une tâche peut réussir après une erreur, dont le coût et la durée doivent rester inclus. Les relances utilisateur, les coûts d'infrastructure, la conformité des fournisseurs et l'encaissement sont des vérifications supplémentaires qui ne sont pas certifiées par ce fichier.

La politique contient `ownerApproved`, `qualityNoise`, `latencyNoiseRatio`, `successNoise` et, si approuvés, `minTasksPerMode` (≥30), `economyCostRatio`, `minimumQuality`, `minimumSuccessRate`. Les valeurs ne viennent pas de l'agent d'auto-amélioration et ne doivent pas être modifiables par un outil runtime. Proposition initiale : bruit zéro, seuils à faire valider ; aucune valeur de production n'est changée.

Refus si moins de 30 tâches uniques appariées dans chaque mode, jeux différents entre modes, source non mesurée, seuils invalides/non approuvés, absence de gain ou régression de qualité/réussite/latence/erreurs. La différence Économique/Équilibré n'est validée que si son ratio approuvé est fourni. Performance est comparé à Équilibré sur les mêmes tâches.

Sortie : métriques agrégées par mode, raisons codées, demande de rollback si régression. Pas de contenu des apps ou des clients. `eligibleForProduction` reste **false**, même si `candidatePassesSuppliedMeasurements` est true : les assertions « live » et « gateway » des fichiers ne sont **pas une preuve cryptographique**. Vérifier les sources réelles, les factures, les sélections explicites, chaque plan/palier/période, puis le canari/rollback avant toute activation. Une réussite d'un seul plan ne certifie pas les autres plans.

Budget des essais réels : dédié et approuvé avant exécution, distinct du solde utilisateur. Aucun essai réel payé n'a été effectué par cette tâche. Le dépôt référence historiquement un runner `scripts/run-reference-live.mjs` qui n'existe pas dans ce commit ; ce validateur n'est pas son remplacement exécutable. Un runner isolé, instrumenté et borné reste à construire avant la campagne réelle.
