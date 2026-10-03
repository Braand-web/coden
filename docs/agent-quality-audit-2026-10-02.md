# Audit des agents Coden — correctifs du 3 octobre 2026

## Résumé et périmètre

Base inspectée : `3130f23` (main). Travail dans une branche isolée ; les modifications préexistantes du checkout utilisateur sont préservées. Cette livraison concerne la boucle agent, ses prompts, sa vérification et sa télémétrie. Elle ne change ni Auth, ni facturation, ni schéma SQL, ni provisioning des applications.

Les traces confirment des dérives d'objectif et des divergences de statut. Elles ne prouvent pas que toutes les applications deviennent des calculatrices. Deux plans dérivent vers une calculatrice ; un des deux projets contient effectivement ce produit incorrect, l'autre a ensuite produit un site de coaching. Une compilation réussie ne constitue pas une preuve de conformité à la demande.

Les corrections sont ciblées et testables. La qualité sémantique de tous les modèles en production, une réparation des projets historiques et un audit de sécurité exhaustif ne sont pas démontrés par les tests locaux.

## Phase 1 — architecture réelle

Coden génère et modifie des applications web depuis une conversation, avec aperçu, versions et publication. L'interface convient à des utilisateurs non développeurs ; aucune segmentation commerciale mesurée n'a été fournie.

Stack constatée dans `package.json` : TypeScript, React 19, Vite 6, Express 5, Supabase, Playwright, E2B, passerelle de modèles. Infrastructure observée : Railway pour Coden ; Supabase central distinct du runtime des applications générées. Budget cible et SLA non définis par l'utilisateur.

```text
Message + fichiers + historique
  → serveur : utilisateur/projet, garde-fous et crédits
  → interprétation d'intention et choix du modèle
  → mission courante + mémoire historique distincte
  → plan LLM → contrôle LLM indépendant contre la demande brute
  → sandbox + boucle d'outils (fichiers, commandes, web, sous-agents)
  → restauration des protections de design AVANT vérification
  → types/runtime → navigateur/acceptation → conformité LLM → build
  → succès : arrêt ; défaut concret : réparation bornée
  → snapshots/fichiers + critères de fin + journal du tour/run
  → aperçu ; publication dans un flux distinct
```

Le chemin multi-agent est activé par défaut ; une voie historique subsiste selon configuration. Les garde-fous de commandes, la rédaction des secrets, l'annulation, les budgets, les checkpoints et les outils de sous-agents existaient déjà. Aucun besoin de réécrire tout l'agent n'a été démontré.

Sources : `server.ts`, `src/services/multi-agent-pipeline.ts`, `planner-agent.ts`, `provider-gateway.ts`, `model-selection.ts`, `llm-tool-loop.ts`, `sandbox/project-sandbox.ts`, `sandbox/command-policy.ts`, `action-guard/hard-rules.ts`, `agent-harness/`.

Checkpoint : conserver ces fondations ; traiter les frontières mission/mémoire, validation et états avant toute refonte.

## Phase 2 — sessions et limites des données

Source : lecture du projet Supabase central, runs, tours, événements Harness, items, messages, checkpoints et fichiers. Extraction effectuée le 2 octobre (journée partielle), bornes utilisées : `2026-09-29T23:00:00Z` inclus à `2026-10-02T23:00:00Z` exclu. Ce sont les trois dates civiles 30 septembre–2 octobre en UTC+1, pas une nouvelle extraction du 3 octobre.

- 39 runs, 3 comptes anonymisés, 17 projets : 27 completed et 12 failed.
- 12 échecs : 9 `RUN_INTERRUPTED`, 2 `SANDBOX_CAPACITY`, 1 `VERIFICATION_INCOMPLETE`.
- 40 tours Harness : 28 completed, 5 failed, 6 cancelled, 1 blocked.
- Vérification run : 38 unknown, 1 incomplete, aucun passed ; action résolue absente sur 40 tours.
- 830 appels d'outils répartis sur 15 tours, moyenne 55,3, maximum 184 ; 4 tours dépassent 100 appels.
- 10 projets build/edit : 7 avec fichiers canoniques, 1 snapshot seul, 2 sans fichiers canoniques ni snapshot exploitable. Cela ne prouve pas une perte de fichiers précédemment enregistrés dans chacun de ces deux cas.
- Une date de fin antérieure à la date de début ; 17 runs sans lien `ai_message_id`.
- Aucun indice confirmé de fuite inter-utilisateur dans les duplications examinées ; ce n'est pas une preuve d'isolation complète.

### Cas anonymisés

A — Une demande de landing dentaire aboutit à un plan de calculatrice et à un `src/App.tsx` arithmétique, 24 fichiers. L'aperçu est qualifié verified malgré le mauvais produit. Le run est interrompu : les journaux ne racontent pas la même histoire.

B — Une demande de site de coaching aboutit d'abord à un plan de calculatrice, puis à un plan et un code de coaching, 25 fichiers. Les sept vérifications échouent ; après une baisse de 18 à 3 erreurs, la séquence oscille 3→4→3, puis reste à 3. Ne pas présenter ce cas comme un code final de calculatrice.

C — Après une proposition de monde 3D et une confirmation « oui », le tour de build est annulé et un sous-agent échoue. Le ledger déclare completed avec une date provenant d'un tour antérieur. Le projet est brouillon, sans fichier récupérable. La confirmation courte était déjà traitée dans le code de base ; le défaut de réconciliation était distinct.

Limites : pas de reconstruction exhaustive des payloads envoyés aux fournisseurs ; pas d'accès à une pensée privée du modèle. L'audit juge les décisions observables, plans, outils, fichiers et résultats. Les causes d'infrastructure des interruptions et la qualité de chaque session n'ont pas toutes été reproduites.

## Phase 3 — causes et priorités

### Critique — substitution de mission

`server.ts` injectait le résumé de reprise au début du prompt ; `resume-brief.ts` demandait de continuer l'ancien travail. Un nouveau besoin pouvait donc recevoir une instruction concurrente. Le planner proposait aussi un exemple de calculatrice dans le prompt de petite tâche, et demandait systématiquement de la persistance.

Ces chemins sont confirmés dans le code. Leur contribution exacte à chaque sortie du modèle reste une hypothèse, faute de payload complet par appel. Correction : demande brute séparée, mémoire étiquetée historique, prompt neutre, contrôle LLM du plan puis de l'artefact. Le modèle décide de la conformité, pas un catalogue de mots-clés.

Effort moyen, impact élevé, risque : refus sémantiques injustifiés et appels supplémentaires. Un seul replan est permis ; absence de preuve ne vaut jamais succès.

### Majeur — état terminé attribué au mauvais tour

`run-ledger.ts` recherchait un tour completed proche temporellement. Une clarification terminée pouvait solder un build interrompu. Correction : liaison exacte `harness_turn_id`, même projet, dates cohérentes. Les anciens runs sans liaison ne sont pas devinés ni réécrits.

Effort faible, impact élevé, risque maîtrisé par tests de collision temporelle.

### Majeur — modifications après réussite

`multi-agent-pipeline.ts` lançait des retouches de design après vérification, puis restaurait éventuellement des fichiers de design après la dernière validation. Correction : supprimer la retouche esthétique automatique ; restaurer avant types/navigateur/build. Ne pas annoncer un artefact différent de celui contrôlé.

Effort moyen, impact élevé. Cela ne désactive pas une modification de design explicitement demandée ni les validations fonctionnelles.

### Majeur — boucles sans amélioration globale

`sandbox/repair-loop.ts` récompensait une baisse par rapport au round précédent : une oscillation pouvait remettre à zéro le compteur. Correction : comparaison au meilleur résultat du tour, arrêt après trois rounds sans progrès (limite existante conservée), nouvelle instruction utilisateur prise en compte.

### Majeur — contexte et instrumentation

`llm-tool-loop.ts` sous-comptait les arguments d'outils et le contenu multimodal. `agent-mission-context.ts` pouvait dépasser son budget avec un message géant. Correction : comptage JSON des arguments/texte, estimation distincte des images sans compter le base64 comme des tokens texte, historique borné.

Le serveur lisait `verification.status`, alors que le pipeline fournit `verification.ok`. Correction de ce mapping, conservation d'un coût connu égal à zéro, persistance de l'action résolue et comptage des appels de planification/vérification réussis. Les coûts d'appels ayant échoué restent partiellement inconnus.

## Phase 4 — décisions et alternatives

- Retenir un évaluateur LLM structuré ancré dans la demande et les fichiers réels. Écarter un détecteur codé en dur « calculatrice vs autre » qui casserait les vrais projets de calculatrice.
- Retirer uniquement les retouches facultatives après succès. Ne pas supprimer les tests pour accélérer artificiellement.
- Conserver les erreurs système honnêtes et les garde-fous déterministes. Ils ne sont pas des réponses produit prédéfinies.
- Préserver les anciennes données. Une fusion des machines d'état, une migration du schéma et une nouvelle stratégie de persistance atomique sont des changements architecturaux distincts à valider.
- Ne pas remplacer les modèles/fournisseurs ou l'authentification pour corriger un défaut de contexte.

## Phase 5 — journal des modifications

- `server.ts` : demande originale, mémoire distincte, lien run/tour, action résolue, statut de vérification et zéro coût.
- `agent-mission-context.ts`, `resume-brief.ts`, `llm-tool-loop.ts` : contexte borné, hiérarchie des instructions, compaction.
- `planner-agent.ts`, nouveau `mission-verifier.ts` : plan contextualisé, replan borné et conformité structurée ; instructions utilisateur arrivées pendant le travail conservées.
- `multi-agent-pipeline.ts`, `sandbox/repair-loop.ts` : arrêt après réussite, restauration avant contrôles, progrès mesuré contre le meilleur round.
- Tests : liens de runs, plan incorrect/replan, réponse incertaine, fichiers inventés, panne fournisseur, grandes sorties d'outils, images, corrections utilisateur, oscillations, ordre restauration/validation/snapshot.
- Hygiène des tests : normalisation CRLF des assertions de fichiers, animations pilotées par temps explicite ; assertions de routage alignées sur le comportement réel.
- Évaluation et monitoring : `evals/mission-alignment.json`, `scripts/eval-mission-alignment.ts`, `scripts/agent-quality-metrics.sql`, `.github/workflows/agent-quality.yml`.

## Phase 6 — validation et métriques

Avant : 1 352 tests unitaires, 1 347 réussis, 5 échecs préexistants (CRLF et timing). Une suite intermédiaire après correction : 1 366 réussis. Les résultats définitifs du lot et du déploiement sont consignés dans `agent-quality-release-2026-10-03.md`.

Tests réels de sandbox avec fournisseur simulé : `test-multi-agent-pipeline.ts` ; tests Harness, frontières de sécurité, runtime généré, redaction, contexte et routage. Le modèle simulé valide l'orchestration, pas l'intelligence d'un fournisseur réel.

Métriques disponibles avant correction :

- 12/39 runs failed (30,8 %) : indicateur technique, pas taux d'échec des tâches de bout en bout.
- Durée médiane 7 582 ms sur 29/39 runs renseignés, toutes intentions confondues : ne représente pas la durée de génération.
- Coût au niveau run : 0/39 valeurs disponibles. Ne pas annoncer de coût moyen.
- Journal de routage : 9 coûts sur 30 lignes, somme partielle 0,6554658 USD ; non extrapolable aux sessions.
- Première action perçue, abandons, nombre de relances et réussite réelle : non mesurés de manière fiable.

Cibles initiales : zéro faux succès dans les fixtures, aucune régression des tests, liaison run/tour et action présentes pour chaque nouveau tour de génération. Mesurer sur une cohorte réelle avant de fixer des objectifs chiffrés de durée/coût ; aucun gain n'est inventé.

## Phase 7 — suivi des quatorze axes et dette restante

1. Bugs/états : liens exacts et vérification corrigés ; pas de correction destructive du passé.
2. Mémoire : séparation et budgets corrigés ; évaluer les résumés sur longs projets et les préférences persistantes.
3. Raisonnement : contrôler résultat contre demande, préserver les tests ; pensée privée hors périmètre observable.
4. Décisions/arrêt : arrêt après réussite et anti-oscillation ; suivre taux de faux refus du nouveau juge.
5. Compréhension : confirmations déjà existantes préservées, demandes nouvelles prioritaires ; tester diversité linguistique et demandes ambiguës.
6. Modèles : routage Auto/manual conservé, décision sémantique LLM, fallback borné ; coût des échecs et comparaison des fournisseurs restent à instrumenter.
7. Vitesse : moins de polish et de boucles ; deux contrôles LLM ajoutent latence/coût. Mesurer, ne pas promettre un gain net.
8. Sorties : exemple produit biaisant retiré ; messages système factuels et sécurité conservés. Pas de preuve qu'il faille supprimer tout texte déterministe.
9. Sécurité : tests de frontières/rédaction, données anonymisées, aucun secret ajouté. Un prompt « contenu non fiable » n'est pas une preuve d'immunité aux injections ; suite adversariale fichiers/web et vérification de l'isolation réelle restent nécessaires.
10. Fiabilité : budgets, annulation/checkpoints conservés, anti-boucle renforcé ; évaluer reprise atomique et coupure réseau/processus séparément.
11. UX : commentaires existants conservés, reprise ne promet plus de poursuivre un ancien besoin ; ne jamais masquer un échec comme succès.
12. Avancé : sous-agents/outils/recherche existent déjà ; indexation sémantique et multi-langages non démontrés de bout en bout.
13. Observabilité : script SQL agrégé et CI reproductible, vrais coûts partiels ; ajouter corrélation complète fournisseurs/outils/version et mesure client du premier événement visible.
14. Manques : transactions snapshot/version/état, corpus live plus large, reprise sous panne, contrôle des références partagées et alertes opérationnelles. Aucun monitoring récurrent externe n'est prétendu activé.

Exécution reproductible : `npm run lint`, `npm run test:unit -- --maxWorkers=2`, `node --experimental-strip-types test-multi-agent-pipeline.ts`, `npm run build`. Évaluation live opt-in : `node --import tsx scripts/eval-mission-alignment.ts` avec clé serveur hors Git ; maximum six cas, seuil de coût mesuré 0,25 USD, pas plafond de facturation garanti. Le script SQL ne lit que des agrégats.

Références publiques de méthode (pas affirmation d'accès aux architectures propriétaires) : https://developers.openai.com/api/docs/guides/agents/running-agents et https://developers.openai.com/api/docs/guides/agent-evals .
