# Vérification de la Communauté — 34 apps de test

Générée par `scripts/community/verify.ts` le 2026-10-01. Pipeline réel (navigateur réel, flou des données personnelles, miniature WebP), base de données et e-mails simulés. Aucun modèle de vision : les cas douteux sont listés sans mise en avant.

- Décisions conformes à l'attendu : **34/34**
- Apps nuisibles ou invalides (13) listées à tort — faux négatifs : **0** (0 %)
- Apps légitimes (21) bloquées à tort — faux positifs : **0** (0 %)
- Durée d'un contrôle complet (navigateur compris) : médiane 1764 ms, maximum 2279 ms

| # | App | Type | Attendu | Obtenu | Code | Qualité | Pourquoi |
|---|-----|------|---------|--------|------|---------|----------|
| g01 | Atelier Lumière | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g02 | Thé & Cie | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g03 | Quiz Géo | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g04 | Suivi des ventes | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g05 | Studio Rive | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g06 | Réserve ta salle | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g07 | Carnet de recettes | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g08 | Cours de code | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g09 | Calculatrice de prêt | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g10 | Liste de tâches | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g11 | Chez Marcel | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g12 | Festival des Lacs | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g13 | Journal du quartier | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| g14 | Guide des API | good | online | ✓ online | checks_passed | 100 | Ordinary, well-made app: must be listed. |
| t01 | Brouillon non publié | trap | not_listed | ✓ not_listed | not_published | — | A draft is never listed. |
| t02 | App protégée par mot de passe | trap | not_listed | ✓ not_listed | protected | — | A protected app is never listed. |
| t03 | Clé secrète dans le code | trap | refused | ✓ refused | secret_in_browser_code | — | A private key delivered to the browser. |
| t04 | PayPal - Connexion | trap | refused | ✓ refused | impersonation | — | A login page impersonating a brand. |
| t05 | Contenu adulte explicite | trap | refused | ✓ refused | moderation_adult | — | Explicit adult content. |
| t06 | Copie quasi identique | trap | needs_fix | ✓ needs_fix | near_duplicate | — | Near-duplicate of g01. |
| t07 | App vide | trap | needs_fix | ✓ needs_fix | empty_render | — | Renders nothing. |
| t08 | Modèle de départ intact | trap | needs_fix | ✓ needs_fix | unmodified_template | — | Still the unmodified starter. |
| t09 | Données personnelles visibles | trap | online | ✓ online | checks_passed | 90 | Contact details on the page: the thumbnail must blur them; the app itself is fine. |
| t10 | Doublez vos bitcoins | trap | refused | ✓ refused | moderation_scam | — | Scam. |
| t11 | Orange Money — sécurité | trap | refused | ✓ refused | impersonation | — | Phishing a mobile-money brand. |
| t12 | Mineur de cryptomonnaie caché | trap | refused | ✓ refused | suspicious_code | — | Hidden crypto-miner. |
| t13 | Redirection suspecte | trap | refused | ✓ refused | suspicious_code | — | Automatic redirect to another site. |
| t14 | Écran de connexion seul | trap | online_plain | ✓ online_plain | login_only | 80 | Login-only: listed but never featured. |
| t15 | Page de qualité faible | trap | online_plain | ✓ online_plain | checks_passed | 37 | Low quality: listed, never featured. |
| t16 | Page qui plante | trap | needs_fix | ✓ needs_fix | page_error | — | Uncaught error on load. |
| b01 | Clone de connexion — exercice | benign_trap | online | ✓ online_plain | login_only | 94 | A learning clone, framed as such, must not be refused. |
| b02 | Boutique — paiement PayPal accepté | benign_trap | online | ✓ online | checks_passed | 97 | A shop that mentions PayPal is not phishing. |
| b03 | App Supabase (clé publique) | benign_trap | online | ✓ online | checks_passed | 94 | A public anon key is not a secret. |
| b04 | Blog crypto pédagogique | benign_trap | online_plain | ✓ online_plain | moderation_unreviewed | 97 | A doubt a model should settle; with no model it is listed but never featured. |

Miniature de t09 : 2 élément(s) flouté(s) (e-mail et téléphone visibles sur la page).
