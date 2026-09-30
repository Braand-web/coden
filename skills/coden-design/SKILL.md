---
name: coden-design
description: À charger à chaque fois qu'un agent Coden crée ou modifie une interface (application, page, composant, écran de chargement, jeu). Impose un processus de design en étapes, des règles de typographie, de couleur, d'espacement, de mouvement et d'accessibilité, et une boucle de critique visuelle notée avant toute livraison.
---

# Coden Design

Cette skill fait produire aux agents Coden des interfaces soignées, distinctives, cohérentes et robustes, au niveau des meilleurs produits du marché. Elle s'applique à **toute** création ou modification d'interface. Pour un petit changement, appliquer au minimum les sections 5 (tokens), 12 (non-régression) et 13 (autocontrôle).

## 1. Principes

1. **Le design system d'abord.** Aucune ligne d'interface avant que les design tokens existent. Aucune valeur en dur (couleur, taille, espacement, rayon, ombre, durée) en dehors des tokens.
2. **Une intention par projet.** Chaque projet a sa propre direction artistique. Ne jamais reprendre par défaut le même style, la même palette ou la même mise en page d'un projet à l'autre.
3. **La retenue.** Quelques choix forts valent mieux que beaucoup de choix faibles. Chaque élément a une raison d'être ; en cas de doute, le retirer.
4. **Voir pour juger.** Un design se juge sur des captures de la preview, jamais sur le code seul. Ne jamais livrer sans avoir regardé le rendu.
5. **Le socle de qualité est non négociable** et n'est pas présenté comme une fonctionnalité : responsive, focus clavier visible, contraste AA, « réduire les animations » respecté, états de chargement, vide et erreur.

## 2. Processus (dans cet ordre)

1. Brief
2. Direction artistique
3. Design tokens
4. Composition (structure de chaque écran)
5. Construction
6. Critique visuelle notée (section 11)
7. Finition et autocontrôle (section 13)

Ne pas sauter d'étape. Pour une itération, reprendre à l'étape concernée sans casser les précédentes.

## 3. Brief

Répondre en quelques lignes avant de concevoir (ne poser une question à l'utilisateur que si la réponse change fortement le résultat) :
- À quoi sert l'application et qui l'utilise ?
- Quelle est l'action principale ?
- Quel ton : sérieux, joueur, luxueux, technique, chaleureux ?
- Quelle densité d'information : aérée, équilibrée, dense ?

Si l'utilisateur a joint une maquette, une capture ou un site de référence, c'est la **référence de design prioritaire** : en extraire la palette, la typographie, la structure et le rythme d'espacement.

## 4. Direction artistique

- Formuler le concept en **une phrase** (exemples : « éditorial chaleureux, fort contraste typographique » ; « tableau de bord technique sobre, haute densité »).
- Choisir 2 ou 3 références (produits ou mouvements de design) et noter ce qu'on leur emprunte, sans les copier.
- Trancher : ton, densité, contraste, forme (angles vifs ou arrondis), matière (aplats, ombres, textures).
- Vérifier que ce choix diffère des derniers projets générés.

## 5. Design tokens (source de vérité unique)

Définir et stocker, avant de coder :
- **Couleurs sémantiques** : fond, surface, surface élevée, bordure, texte principal, texte secondaire, texte discret, accent, succès, avertissement, danger, focus. Variantes claire et sombre.
- **Échelle typographique** : tailles, graisses, interlignes.
- **Espacement** sur une grille de 4 ou 8 px.
- **Rayons, ombres, bordures.**
- **Mouvement** : durées et courbes d'accélération.

Les tokens sont la seule source : les composants les consomment, ne les redéfinissent jamais.

## 6. Typographie

- **Une ou deux familles.** Si deux, elles doivent être nettement distinctes (par exemple une serif d'affichage et une sans de lecture).
- **Choisir avec intention.** Ne pas retomber par réflexe sur la police par défaut du système ou la plus courante ; choisir une police adaptée au ton du projet.
- **Échelle cohérente** (rapport de 1,2 à 1,333 entre niveaux) avec des tailles fluides (`clamp`) pour les titres.
- **Interlignage** : 1,5 à 1,7 pour le texte courant, 1,1 à 1,25 pour les titres.
- **Longueur de ligne** : 45 à 75 caractères pour le texte courant.
- **Détails** : chiffres tabulaires pour les données, espacement des lettres pour les petites capitales, pas de texte justifié sur mobile.
- **À éviter** : dégradé de texte sur tous les titres, petit libellé en capitales au-dessus de chaque titre, marqueurs numérotés (01 / 02 / 03) quand le contenu n'est pas une vraie séquence, tout centré.
- **Performance** : polices auto-hébergées, sous-ensemble de caractères, affichage de secours immédiat.

## 7. Couleur

- **Règle 60 / 30 / 10** : neutres dominants, couleur secondaire, une seule couleur d'accent (deux au maximum).
- **Neutres légèrement teintés** plutôt que du gris pur ; éviter le noir et le blanc purs.
- **Contraste AA** : 4,5:1 pour le texte, 3:1 pour le grand texte et les éléments d'interface.
- **Thème sombre ≠ thème clair inversé** : saturation réduite, surfaces plus claires à mesure qu'elles s'élèvent, bordures discrètes.
- **Ne jamais porter une information par la couleur seule** (ajouter icône ou texte).
- **À éviter** : dégradé violet-bleu générique, néons sans raison, arc-en-ciel d'accents.

## 8. Espacement, grille et composition

- Espacements pris **uniquement** dans l'échelle des tokens.
- Un **point focal par écran** : l'œil sait où aller en moins d'une seconde.
- **Rythme vertical** régulier entre sections, avec des respirations franches.
- **Densité adaptée** au type d'application : dense pour un tableau de bord, aérée pour un site vitrine.
- **Varier la composition** : éviter une suite de cartes identiques alignées ; jouer sur l'échelle, l'asymétrie, le contraste de taille.
- Alignements précis sur la grille, conteneurs de largeur maîtrisée.

## 9. Composants, états et contenus

- **Ne pas réinventer** les composants complexes (modale, menu, liste déroulante, sélecteur de date, onglets) : utiliser des composants accessibles éprouvés (par exemple shadcn/ui et Radix UI).
- **Tous les états** pour chaque élément interactif : repos, survol, focus visible, actif, désactivé, chargement, erreur, succès.
- **Un seul bouton principal** par vue ; hiérarchie claire entre principal, secondaire, discret.
- **Zones tactiles** d'au moins 44 px sur mobile.
- **Formulaires** : libellés visibles, aide, validation en ligne, message d'erreur qui explique comment corriger.
- **Chargement** : utiliser le composant de shimmer partagé du projet s'il existe ; sinon des squelettes fidèles à la forme du contenu final, sans saut de mise en page.
- **État vide** : explication et action proposée, jamais un écran blanc.
- **Icônes** : une seule famille cohérente (par exemple Lucide), jamais d'emojis en guise d'icônes.
- **Contenu réaliste** : jamais de texte de remplissage (« lorem ipsum ») ni de nom générique visible dans le rendu final.

## 10. Images, illustrations et mouvement

**Images**
- Quand une image est nécessaire, **dessiner une illustration en SVG** adaptée au projet, ou utiliser une image libre de droits. Jamais d'emplacement vide ni d'image cassée.
- Formats modernes, chargement différé, dimensions réservées, texte alternatif pertinent.

**Mouvement**
- Durées : 150 à 250 ms pour les micro-interactions, 300 à 500 ms pour les transitions de page.
- Entrée en décélération, sortie en accélération.
- **Animer uniquement `transform` et `opacity`** pour rester à 60 fps.
- Un mouvement sert l'usage (guider l'œil, confirmer une action), jamais la décoration seule.
- **Échelonner avec retenue** : pas plus de quelques éléments en cascade.
- Respecter « réduire les animations » : remplacer par un fondu très court ou supprimer.
- Jamais plus de 3 flashs par seconde.

## 11. Critique visuelle notée (avant toute livraison)

1. **Capturer** la preview : mobile (360 px), tablette (768 px), bureau (1280 px et plus), thèmes clair et sombre, après stabilisation du rendu.
2. **Lire la structure** (DOM, console, erreurs) en plus de l'image.
3. **Noter sur 100** :

| Critère | Points |
|---|---|
| Hiérarchie visuelle et lisibilité | 15 |
| Typographie | 12 |
| Espacement, grille et rythme | 12 |
| Couleur et contraste | 12 |
| Cohérence des composants et des tokens | 10 |
| Détails et états (survol, focus, chargement, vide, erreur) | 10 |
| Mouvement | 6 |
| Accessibilité et responsive | 13 |
| Distinctivité (ne ressemble pas à un modèle) | 10 |

4. **Tests rapides** : test des 5 secondes (comprend-on l'objet de la page ?), test des yeux plissés (la hiérarchie tient-elle quand tout est flou ?), test du retrait (quel élément peut-on enlever sans perte ?).
5. **Corriger d'abord le défaut au plus fort impact**, puis recapturer.
6. **Seuil de livraison : 85 / 100 et aucun défaut d'accessibilité bloquant.** Maximum 4 itérations. Au-delà, livrer honnêtement en listant ce qui reste à améliorer.

## 12. Non-régression et persistance

- Les tokens sont enregistrés côté serveur avec le projet : le design survit à une itération, à un rafraîchissement et à la fermeture de la page.
- Une modification de composant **ne réécrit jamais** le fichier de tokens ni les styles globaux, sauf demande explicite de l'utilisateur.
- Modifications **ciblées** : ne toucher que ce que l'utilisateur a demandé, sans régénérer le reste.
- Comparer les captures **avant et après** chaque itération. Si une zone non demandée a changé, ou si le design a été perdu, corriger avant de livrer.
- Les réglages de design faits par l'utilisateur (couleur principale, police, espacement) passent par les tokens et se répercutent sur toute l'application.

## 13. Autocontrôle final

Avant de livrer, vérifier :
- [ ] Tokens définis et utilisés partout, aucune valeur en dur
- [ ] Direction artistique distincte des projets récents
- [ ] Un point focal par écran, un seul bouton principal par vue
- [ ] Tous les états gérés (chargement, vide, erreur, focus)
- [ ] Contraste AA, navigation au clavier, « réduire les animations » respecté
- [ ] Responsive sans défilement horizontal, testé mobile, tablette, bureau
- [ ] Console sans erreur, aucune image cassée, aucun texte de remplissage
- [ ] Score de critique ≥ 85 / 100
- [ ] Captures avant/après comparées, aucune régression

## 14. Anti-modèles à bannir (« look généré »)

- Dégradés violet-bleu génériques et halos décoratifs sans raison
- Grille de cartes identiques avec icône, titre et texte répétés
- Emojis utilisés comme icônes
- Même mise en page hero + trois cartes + témoignages d'un projet à l'autre
- Texte de remplissage, noms et chiffres fictifs visibles
- Ombres et bordures arrondies partout sans hiérarchie
- Animations qui retardent l'usage ou qui bougent tout en même temps
- Police par défaut choisie par réflexe
- Contraste faible « pour faire élégant »

## 15. Ressources gratuites recommandées

Toujours vérifier la **licence** et l'état de **maintenance** avant d'intégrer.
- Composants : shadcn/ui, Radix UI
- Icônes : Lucide, Phosphor
- Polices : Fontsource, Google Fonts (auto-hébergées)
- Mouvement : Motion (ex-Framer Motion), CSS natif, GSAP (vérifier les conditions)
- Jeux : Canvas, Phaser, Three.js

## 16. Cas particuliers

- **Tableau de bord** : densité maîtrisée, tableaux lisibles, graphiques sobres, états vides utiles.
- **Site vitrine** : récit en sections, une accroche forte, typographie expressive, performance irréprochable.
- **E-commerce** : fiches produit claires, parcours d'achat court, confiance (avis, retours, sécurité).
- **Jeu** : interface de jeu lisible, contraste élevé, retours visuels immédiats, commandes clavier, souris et tactile, pause.
- **SaaS** : onboarding court, navigation constante, tableau de bord utile dès la première visite.
