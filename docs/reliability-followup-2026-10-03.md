# Persistance et réparations ciblées — 3 octobre 2026

Base : `31b2368`. Ce lot renforce les trois priorités de l'audit sans migration de schéma, modification de RLS, Auth ou facturation.

## Corrections

1. Les écritures de snapshots utilisent une comparaison de révision. Un ajout concurrent de message ou d'événement relit l'état actuel avant de réessayer ; une création simultanée du premier snapshot est également traitée. Le nombre d'essais est borné. Un échec ou une absence d'accusé de réception ne valent jamais succès.
2. Un échec de lecture de conversation/workspace ne remplace plus le secours enregistré par une liste vide. Les erreurs d'accès ou de réseau ne sont plus assimilées à une table de snapshots absente.
3. La boucle de génération exige un checkpoint effectivement sauvegardé. La sauvegarde finale vérifie qu'au moins les fichiers canoniques ou le snapshot existent ; l'épuisement des essais de compatibilité de schéma déclenche une erreur explicite.
4. Lorsqu'une première génération interrompue n'a pas encore de fichiers définitifs, le tour suivant charge son brouillon sauvegardé. Les fichiers définitifs existants restent prioritaires : aucun mélange avec un brouillon non validé.
5. Un écart de mission n'est plus présenté au modèle comme une panne de compilation. Les chemins de fichiers servent au diagnostic, sans interdire de réparer une dépendance réellement responsable. La consigne préserve fonctionnalités, design et tests ; elle interdit de régénérer toute l'application pour masquer une erreur locale.

## Vérification

Tests automatisés : course à la création, quatre ajouts concurrents, écritures indépendantes fichiers/messages/workspace, conservation d'identité, accès refusé, conflit borné, reprise après réouverture, refus de régénérer après lecture en échec, consignes de réparation. Tests d'intégration locaux : persistance existante, sandbox avec import réellement défectueux, pipeline complet avec modèle simulé, routage et frontières de sécurité.

La CI inclut désormais le test de persistance durable. Aucun secret ajouté. Les changements utilisateur du checkout d'origine sont préservés.

## Limites à ne pas confondre avec une garantie

- La comparaison de révision protège une ligne de snapshot, pas une transaction entre les tables projects, project_files, project_versions et Harness. Leur promotion atomique complète reste un chantier distinct avec migration et validation sur base réelle.
- Les tests concurrents utilisent un stockage simulant les opérations conditionnelles ; ils ne remplacent pas un test Supabase de production. Pendant un déploiement progressif, un ancien processus peut encore écrire selon l'ancien protocole.
- Le modèle demeure responsable de l'analyse et du choix de réparation. Les consignes ne prouvent pas à elles seules l'absence de dérive.
- Les actions des connecteurs Supabase/Railway et une clé modèle locale ne sont pas disponibles dans cette conversation. Le rejeu authentifié avec vrais modèles n'est donc pas déclaré effectué. Déploiement suivi via le statut Railway du commit GitHub, puis contrôles HTTP publics.
- Ce lot ne prétend pas réparer rétroactivement les applications historiques ni garantir l'absence absolue de perte sous toute panne.
