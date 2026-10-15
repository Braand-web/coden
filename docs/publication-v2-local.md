# Publication V2 — livraison locale

Cette évolution est désactivée par défaut (`CODEN_PUBLICATION_V2=0`). Le push du
code ne remplace pas l’activation de l’infrastructure. Aucun déploiement, aucune
migration distante ni aucun email réel n’est nécessaire pour l’aperçu local.

## Prévisualisation

Exécuter `node --import tsx scripts/publication-preview.ts`, puis ouvrir
`http://127.0.0.1:4181/`. La fixture utilise le vrai panneau, le service de
publication, la file durable et PostgreSQL PGlite **0.5.9**, dépendance de
développement uniquement. Cloudflare, les comptes et la livraison des invitations
sont simulés. La base générée reste dans `artifacts/publication-v2-preview/`, ignoré
par Git. Le serveur écoute uniquement sur l’interface locale.

Le bouton principal ouvre les paramètres ; le bouton du panneau confirme la
publication sans troisième écran. Fermer le panneau ne supprime pas le job.
Les comptes simulés permettent de distinguer propriétaire, invité et non invité.

## Comportements implémentés

- Brouillon distinct de la configuration active ; fichiers, médias, paramètres
  et hôtes capturés à la confirmation. Empreinte du contenu, pas des dates.
- Jobs `agent_jobs` avec prise atomique, bail renouvelable, garde d’activation,
  idempotence, verrou par projet et événements séquencés. Reprise explicite bornée
  d’une opération incertaine, jamais répétition aveugle de l’appel fournisseur.
- Publications Workers : candidat protégé, contrôle du contenu puis de la
  passerelle servie, activation en base et retrait des anciennes origines publiques.
- Gate d’accès avant HTML, scripts, images et routes serveur. Refus des hôtes
  fournisseur non autorisés, accès fail-closed, session visiteur distincte du compte
  Coden, code de transfert à usage unique et vérification des invitations actuelles.
- Audience publique, sur invitation ou espace Business. Une invitation ne crée
  aucun membre du projet. Une app privée est retirée de la Communauté.
- Métadonnées, alias après renommage, dépublication et restauration de contenu
  sous la politique actuelle, sans restaurer d’anciennes invitations.
- Retrait incomplet conservé en base et récupérable après actualisation. Les
  nouveaux déploiements restent bloqués jusqu’au nettoyage fournisseur confirmé.
- Invitations dans une outbox après activation ; un échec de livraison ne défait
  pas la publication. Le transport réel exige `CODEN_PUBLICATION_EMAILS=1`, non
  activé dans cette livraison.

## Préparation d’un futur environnement de test

Les deux migrations générées avec le CLI sont conservées dans
`supabase/migrations/20261015043041_durable_agent_job_queue.sql` et
`supabase/migrations/20261015043635_publication_v2.sql`. Elles ne doivent être
appliquées en production qu’après revue et essai sur un environnement de test.

`npm run publication:check` vérifie la configuration sans afficher les secrets.
`npm run publication:check -- --remote` ajoute uniquement des lectures des schémas
Supabase et du compte Workers. Ce diagnostic ne crée aucune ressource, n’applique
aucune migration et n’envoie aucun email. Il doit être exécuté avec les variables
de l’environnement dédié, pas en recopiant celles de production. Un résultat
positif vérifie des prérequis, pas une publication réelle.

Outre la configuration Cloudflare existante, la passerelle utilise
`CLOUDFLARE_WORKERS_SUBDOMAIN`, `CODEN_PUBLICATION_PLATFORM_SECRET` (secret serveur
aléatoire fort) et une origine Coden HTTPS. Aucun de ces secrets ne doit être
préfixé `VITE_` ou transmis aux modules générés. Le projet généré s’exécute dans
un Worker distinct de la passerelle qui détient les secrets de contrôle d’accès.
Le jeton Cloudflare du chemin historique Pages ne suffit pas : le compte cible
doit autoriser les écritures Workers Scripts (versions, déploiements, assets et
domaines), ainsi que la lecture de son sous domaine Workers. Le routage des
domaines doit confirmer `enabled: true` et `previews_enabled: false`.

Les constructions avec scripts passent par le microVM existant. Les projets Node
ou Vercel non compatibles Workers sont refusés explicitement, jamais aplatis en
site statique. Un bundle Worker compatible doit produire `server/index.mjs` ou
`server/index.js`, avec ses modules dans `server/` et ses assets dans `public/`
sous le répertoire de sortie déclaré. Les liaisons serveur supplémentaires doivent
être configurées avant leur prise en charge ; elles ne sont pas inventées.

## Limites de validation

PGlite et les fournisseurs simulés ne prouvent pas le comportement réel de
Cloudflare, de Supabase Auth/PostgREST, des DNS/certificats ou de Resend. La
concurrence SQL, les cookies et les scénarios de panne sont couverts localement,
mais un essai multi-processus réel et une publication de test HTTPS restent
nécessaires avant activation. Les domaines personnalisés doivent appartenir à
une zone compatible avec l’API Workers utilisée ; un simple CNAME n’établit pas
cette propriété.

Le scan affiché décrit sa couverture statique ; il ne garantit pas à lui seul
toutes les règles RLS et intégrations d’une application. Des fichiers déjà
téléchargés quand une application était publique ne peuvent pas être effacés chez
les visiteurs.

Références : https://docs.lovable.dev/features/publish et
https://developers.cloudflare.com/workers/static-assets/routing/worker-script/.
L’observation REA de Lovable n’a vu qu’une vérification anti-bot : cette livraison
ne prétend pas reproduire un backend propriétaire observé.
