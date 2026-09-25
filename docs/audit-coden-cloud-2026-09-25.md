# Audit Coden Cloud — 25 septembre 2026

Méthode : lecture du code (`src/builder-live.ts`, `server.ts`, services), requêtes sur la base de production (lecture seule, sans lire de valeur secrète), logs Railway, captures des 12 onglets en clair, sombre et mobile (390 px) via l’aperçu local, relevé des erreurs console et réseau.

## Bloquant

| # | Onglet | Problème | Cause |
|---|---|---|---|
| B1 | Vue d’ensemble, Base de données, Paramètres, pied de navigation | « Non détecté » affiché pour 100 % des projets, sans explication ni action | 73/92 projets n’ont aucune analyse backend (la détection ne se fait que sur les mots-clés du premier prompt) ; les 19 autres sont au statut `planned`, que l’interface ne reconnaît pas et range dans « Non détecté ». Aucun backend n’a jamais été provisionné (0/92) et les échecs de provisionnement ne sont pas journalisés. |
| B2 | Secrets | Les valeurs ne sont pas chiffrées mais hachées (`sha256:sel:empreinte`) : elles sont irrécupérables | `pseudoEncryptSecret` fait un hachage. Les 2 secrets existants en production sont dans ce format. Conséquence : aucune fonction ni application ne peut lire un secret, et le texte « chiffrées » est faux. |
| B3 | Secrets, Fonctions | Les secrets ne parviennent jamais au serveur de l’application | Seules `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont transmises à la sandbox. |
| B4 | Stockage | Tout import échoue (erreur 500) | Le bucket `project-assets` n’existe pas en production (seuls `media` et `chat-attachments` existent). De plus, l’URL publique est générée alors que l’interface annonce un bucket privé. |
| B5 | Mobile, tous les onglets | La console Cloud est inaccessible sur téléphone | L’onglet « Cloud » ne change pas la vue mobile (le chat reste affiché). Le bouton « Plus » ouvre le menu et le referme aussitôt, car le clic remonte au gestionnaire « clic à l’extérieur ». |

## Majeur

| # | Onglet | Problème |
|---|---|---|
| M1 | En-tête | « Coden Cloud » apparaît trois fois : marque de la navigation, surtitre de la page et pied de navigation. |
| M2 | Secrets | « Ajouter un secret » en double (en-tête et état vide). Aucune modification ni remplacement possible. Réenregistrer une variable crée un doublon (insert au lieu d’upsert). La fenêtre se ferme sur une erreur de validation et l’erreur de l’API n’est pas affichée. Suppression via `window.confirm`. |
| M3 | Secrets | `GET /database/secrets` ne vérifie pas le droit d’accès au projet (un lecteur voit les noms et masques). |
| M4 | E-mails, Fonctions, Utilisateurs | Actions principales en double : « Configurer » et « Configurer Resend » ; « Créer une fonction » et « Créer avec Coden » ; « Inviter » dans l’en-tête et dans le formulaire. |
| M5 | Utilisateurs | Formulaire d’invitation actif alors que l’API répond toujours 409 (authentification non provisionnée) : action trompeuse. |
| M6 | Base de données | La carte « RLS » affiche « Non détecté » comme valeur par défaut. Le navigateur de tables n’explique pas comment activer le backend. |
| M7 | Admin > Santé | La carte « Coden Cloud » ignore `CODEN_SUPABASE_MGMT_TOKEN` et affiche « Jeton manquant » alors qu’il est configuré. |
| M8 | Transverse | Les confirmations et retours passent par `window.confirm` et des messages système dans le chat, au lieu de modales et de toasts. |

## Mineur

| # | Onglet | Problème |
|---|---|---|
| m1 | Statistiques | Libellés en anglais (« Visitors », « No data yet ») ; graphique vide affiché sans données. |
| m2 | Base de données | Le nom de schéma se coupe au milieu du mot (« app_pulseboar / d »). |
| m3 | Utilisateurs | Grand espace vide entre le formulaire et l’état vide. |
| m4 | Tâches planifiées | Statuts bruts en anglais (`active`, `paused`, `manual`). |
| m5 | Consommation, Journaux | Types bruts (`build`, `ai_gateway`, `deploy`) au lieu de libellés lisibles. |
| m6 | Paramètres | Toujours « RLS requise » et « Région auto » même sans backend ; pas d’action de provisionnement. |
| m7 | Aperçu local | Le jeu de données simulé est « Provisionné », ce qui masque l’état réel de la production. |
| m8 | Logs | « [coden:job_queue] Skipped — Supabase not configured » sur certains démarrages du 23/09 (transitoire, non reproduit depuis). |

Console et réseau : aucune erreur JavaScript dans la console Cloud. Seule erreur, propre à l’aperçu local : `/api/ai/models` en 404, faute de serveur.
Mode sombre : pas de défaut de contraste relevé. Débordement horizontal : aucun, à 1440 px comme à 390 px.
