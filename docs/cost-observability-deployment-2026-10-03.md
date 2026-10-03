# Socle de coûts — déploiement désactivé, 3 octobre 2026

## Périmètre de la livraison

Livraison préparée depuis `origin/main` au commit `795514040107b6a9f14eabd92b28f6398410ad35`, après intégration initiale de `31b2368`. Les correctifs intermédiaires de paiement, de comptabilisation concurrente et de sécurité sont préservés. Réutilise les mécanismes déjà présents : `usage_events`, capture terminale, `provider_cost_catalog`, synchronisation des prix, rapprochement fournisseur, onglet Coûts et alertes admin. La nouvelle projection par tentative n'est jamais additionnée au registre de facturation.

Le flag `CODEN_COST_OBSERVABILITY_V1` absent ou différent de `1` désactive la nouvelle collecte, son writer, ses détails de tarifs et son panneau admin. Aucun changement de prix, plans, paliers, crédits, modèles, modes, raisonnement, estimation ou décision de routage. Aucun plafonnement contraignant, économie ou changement de fournisseur activé. Aucune migration distante appliquée par cette livraison.

## Cible identifiée en lecture seule

- Railway : projet `9b7db094-03ac-4d72-914c-7a81f159537f`, service `512b8778-70e4-49bf-bfd4-35fae0c035b7`, environnement production `33bd997e-3a0b-4250-bc42-513ac0604afb`.
- Dépôt `Braand-web/coden`, domaine `coden.fun` ; déploiement antérieur vérifié `b876a354-439b-4474-82db-d1f6317cba49`, statut SUCCESS, commit `7955140`.
- Base centrale : `ftmbiocvslxctldfihcp.supabase.co`. Runtime des apps distinct : aucune mutation par cette tâche.
- Flag nouveau absent lors de la lecture. Flags de capture/synchronisation/rapprochement existants préservés, pas basculés.
- Empreinte SHA-256 de la réponse JSON `/api/billing/pricing` avant livraison : `afa7ac0c39a30a84c0dc3c5df2b68cebebab63b9dfc831a02450fb2d1243f01d`.

## Validation et procédure

Avant push : **1 420 tests unitaires réussis sur 183 fichiers, zéro échec**, TypeScript et build réussis. Tests de frontières de sécurité, contrat server-only, harness et câblage multi-agents réussis. Invariance commerciale, comparaison du payload/résultat SSE avec flag off/on en simulation, confidentialité, appels inconnus distincts d'un coût nul, ratios de cache sur mesures valides seulement, réutilisation du catalogue daté, gate et manifestes de benchmark couverts. Un test Vercel intermittent a passé en isolé puis dans la relance complète, sans modification. Le build ne valide pas les coûts ou la qualité des modèles réels.

Push fast-forward uniquement, sans écraser les changements préexistants du checkout principal. Contrôler le commit et le statut de l'autodéploiement ; ne pas lancer un doublon s'il est déjà en cours. Après succès : santé HTTP, réponse de tarifs avec empreinte identique, pages publiques principales, refus des routes admin sans authentification, flag nouveau toujours désactivé. Le résultat effectivement observé est rapporté dans le compte rendu de livraison, pas présumé par cette procédure.

Retour arrière : garder le flag désactivé ; revenir au déploiement précédent si une régression de ce socle apparaît. Aucun rollback SQL destructeur. Ne pas modifier les flags de mesure/facturation déjà présents.

## Ce qui n'est pas validé par cette livraison

Factures réelles, TVA/frais et marges nettes par plan ; campagne réelle 32 tâches × 3 modes × avant/après ; conformité de chaque fournisseur ; coût de la nouvelle collecte sous charge ; ACL/RLS réelles de la migration non appliquée ; canari et contrôleur de rollback automatique. Ces points empêchent d'activer des optimisations ou de promettre une rentabilité permanente. Aucun gain mensuel réalisé revendiqué.

Le rapport `cost-audit-2026-10-01.md` contient des mesures historiques datées, pas les soldes actuels. Les recommandations restent séparées de l'offre commerciale.
