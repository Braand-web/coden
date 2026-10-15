# Publication V2 — livraison et activation

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

## État de la base existante — 15 octobre 2026

À la demande explicite du propriétaire, les deux migrations ont été appliquées
directement au projet Supabase existant `ftmbiocvslxctldfihcp` (branche `main`,
production), sans créer de branche de test ni modifier les projets ou leurs
fichiers. Chaque migration a été exécutée dans une transaction avec des délais
de verrouillage et d’exécution bornés, puis inscrite dans l’historique Supabase :

- `20261015043041_durable_agent_job_queue.sql` ;
- `20261015043635_publication_v2.sql`.

Une lecture du catalogue après application a confirmé les deux versions,
les sept tables de publication avec RLS activée, l’absence d’accès direct pour
`anon` et `authenticated`, les huit fonctions de publication réservées au serveur
et les neuf colonnes de suivi attendues pour la file durable. Aucune publication
V2 n’était active au moment de cette vérification.

Ces migrations sont déjà appliquées : ne pas les rejouer manuellement. Cette
vérification du schéma ne constitue pas une validation du déploiement Cloudflare,
de l’authentification visiteur ou des emails. L’activation du serveur reste une
opération séparée ; aucun secret n’est conservé dans ce document.

## Configuration et mise en service

Les migrations générées avec le CLI sont conservées dans `supabase/migrations/`.
Pour toute nouvelle installation, les relire et privilégier un environnement
dédié avant la production. L’application directe décrite ci-dessus correspond
au choix explicite du propriétaire pour son instance existante.

`npm run publication:check` vérifie la configuration sans afficher les secrets.
`npm run publication:check -- --remote` ajoute uniquement des lectures des schémas
Supabase et du compte Workers. Ce diagnostic ne crée aucune ressource, n’applique
aucune migration et n’envoie aucun email. L’exécuter depuis l’environnement
serveur visé, avec ses variables déjà configurées ; ne pas recopier les secrets
dans le dépôt ou le navigateur. Un résultat positif vérifie des prérequis, pas
une publication réelle.

Outre la configuration Cloudflare existante, la passerelle utilise
`CLOUDFLARE_WORKERS_SUBDOMAIN`, `CODEN_PUBLICATION_PLATFORM_SECRET` (secret serveur
aléatoire fort) et une origine Coden HTTPS. Aucun de ces secrets ne doit être
préfixé `VITE_` ou transmis aux modules générés. Le projet généré s’exécute dans
un Worker distinct de la passerelle qui détient les secrets de contrôle d’accès.
Le jeton Cloudflare du chemin historique Pages ne suffit pas : le compte cible
doit autoriser les écritures Workers Scripts (versions, déploiements, assets et
domaines), ainsi que la lecture de son sous domaine Workers. Le routage des
domaines doit confirmer `enabled: true` et `previews_enabled: false`.

L’ordre de mise en service est le suivant : configurer les variables sur le
serveur Coden existant, lancer le diagnostic distant en lecture seule, puis
activer `CODEN_PUBLICATION_V2=1` et redémarrer ce serveur avec la version du code
correspondante. Garder `CODEN_PUBLICATION_EMAILS=0` tant que l’envoi réel n’est pas
explicitement activé. Un push Git ne configure pas ces variables et ne prouve pas
qu’un déploiement a réussi. Ne déclarer une publication opérationnelle qu’après
vérification de la version effectivement servie et de sa politique d’accès.

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
