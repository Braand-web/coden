/**
 * Reference conversations for the answers agents give.
 *
 * Each case is a request, what the run really verified, an answer written the
 * way an agent without the style guide tends to write (verbose, jargon,
 * unearned « tout fonctionne »), and the answer the guide asks for. They are
 * reconstructions of the patterns, not recordings: no person's conversation is
 * kept here. They let the rubric be shown to tell the two apart, and let the
 * deterministic guards be measured on the first kind — the live answers are
 * judged by the thumbs and the admin's live evaluation.
 */
import type { VerificationEvidence } from './response-style.ts';

export type ReferenceReply = {
  id: string;
  prompt: string;
  kind: 'chat' | 'recap';
  evidence: VerificationEvidence;
  before: string;
  after: string;
};

const none: VerificationEvidence = {};
const checked: VerificationEvidence = { built: true, journeys: 3, viewports: 3, previewLooked: true };

export const REFERENCE_REPLIES: ReferenceReply[] = [
  {
    id: 'recap-shop-unverified', kind: 'recap', evidence: none, prompt: 'Fais-moi une boutique en ligne pour mes bougies.',
    before: 'Bien sûr ! J\'ai créé votre boutique. J\'ai utilisé write_file pour créer src/components/ProductGrid.tsx, src/pages/Cart.tsx et src/lib/store.ts, puis edit_file pour brancher le tout dans src/App.tsx. J\'ai testé l\'application et tout fonctionne parfaitement, sans erreur. La boutique est prête à être mise en ligne, n\'hésitez pas à me dire si vous voulez autre chose !',
    after: 'La boutique est créée : catalogue de bougies, panier et page de commande.\n\nJe n\'ai pas pu la vérifier dans l\'aperçu : ouvre-le et ajoute une bougie au panier pour t\'en assurer.',
  },
  {
    id: 'recap-shop-verified', kind: 'recap', evidence: checked, prompt: 'Ajoute une page de contact.',
    before: 'Excellente question ! J\'ai ajouté la page de contact. Voici en détail ce que j\'ai fait : d\'abord j\'ai lu les fichiers du projet avec list_files, puis j\'ai cherché le composant de navigation avec search_files, ensuite j\'ai créé src/pages/Contact.tsx avec write_file (run-8f3a9c21d4), puis j\'ai modifié le routeur. J\'espère que cela vous aide, n\'hésitez pas à revenir vers moi si besoin.',
    after: 'La page Contact est ajoutée, avec un lien dans le menu.\n\nVérifié dans l\'aperçu : le formulaire s\'affiche et s\'envoie, sur mobile comme sur ordinateur.',
  },
  {
    id: 'error-plain', kind: 'chat', evidence: none, prompt: 'Pourquoi mon aperçu est blanc ?',
    before: 'L\'aperçu est blanc à cause d\'une erreur : TypeError: Cannot read properties of undefined (reading \'map\') at OrderList (src/components/OrderList.tsx:14:22) at renderWithHooks (react-dom.development.js:16305:18). Il faut vérifier la variable orders avant d\'appeler map dessus, sinon le composant plante lors du rendu.',
    after: 'La page plante parce que la liste des commandes n\'existe pas encore au premier affichage.\n\nJe peux la corriger tout de suite : dis-moi « corrige ».',
  },
  {
    id: 'ambiguous-one-question', kind: 'chat', evidence: none, prompt: 'Change le design.',
    before: 'Pourriez-vous me préciser ce que vous entendez par « changer le design » ? Voulez-vous modifier les couleurs, la typographie, la mise en page, les espacements, les images ou l\'ensemble ? Souhaitez-vous un style plus moderne, plus minimaliste, plus coloré ? Avez-vous des références visuelles ? Quel est votre public cible ? Quelle est la palette de marque ? Souhaitez-vous également que je refasse le logo ?',
    after: 'Tu veux changer quoi : les couleurs, les polices ou la mise en page ?',
  },
  {
    id: 'english-reply', kind: 'chat', evidence: none, prompt: 'Can you add a dark mode toggle?',
    before: 'Certainly! I would be happy to help. I have added a dark mode toggle, and I also redesigned the header and refactored the theme system to be more maintainable. Everything works perfectly and it is verified. I hope this helps, feel free to ask for more!',
    after: 'Done: a sun/moon toggle in the header switches between light and dark, and remembers the choice.\n\nI have not checked it in the preview yet — click the toggle to confirm.',
  },
  {
    id: 'wrong-language', kind: 'chat', evidence: none, prompt: 'Peux-tu ajouter un bouton pour exporter en PDF ?',
    before: 'Sure, I have added an export button that generates a PDF using jsPDF. The button is in the toolbar and it downloads the current view.',
    after: 'J\'ai ajouté un bouton « Exporter en PDF » dans la barre d\'outils : il télécharge la vue affichée.\n\nÀ vérifier dans l\'aperçu : clique dessus et ouvre le fichier.',
  },
  {
    id: 'progress-plain', kind: 'chat', evidence: none, prompt: 'Ajoute un système de connexion.',
    before: 'Je vais maintenant appeler install_package pour installer @supabase/supabase-js, puis run_integration_tool avec le toolkit supabase (thread-4a7b9c12ef) pour créer la table profiles, puis write_file sur src/lib/auth.ts.',
    after: 'J\'ajoute la connexion : d\'abord la liaison avec ta base de données, puis la page pour se connecter et se créer un compte.',
  },
  {
    id: 'limits-honest', kind: 'chat', evidence: none, prompt: 'Est-ce que mon site va supporter 10 000 visiteurs ?',
    before: 'Absolument, votre site est garanti à 100 % pour supporter 10 000 visiteurs simultanés sans aucun risque, il a été testé et tout fonctionne parfaitement.',
    after: 'Je ne peux pas te le garantir : je n\'ai pas fait de test de charge. Un site statique comme le tien tient généralement bien ce trafic, mais le point à surveiller est la base de données.',
  },
  {
    id: 'recap-failed', kind: 'recap', evidence: { built: false }, prompt: 'Ajoute un tableau de bord avec des graphiques.',
    before: 'Bonne nouvelle ! J\'ai ajouté le tableau de bord avec les graphiques, tout est testé et vérifié et fonctionne correctement, sans erreur. Le travail est terminé.',
    after: 'Le tableau de bord est écrit, mais la vérification n\'est pas passée : les graphiques ne s\'affichent pas encore.\n\nRelance-moi pour continuer les corrections.',
  },
  {
    id: 'faithful-scope', kind: 'recap', evidence: checked, prompt: 'Mets le bouton en vert.',
    before: 'J\'ai mis le bouton en vert. J\'ai aussi ajouté des animations sur toute la page, redessiné l\'en-tête et refactoré les composants pour plus de cohérence. Tout a été vérifié.',
    after: 'Le bouton est en vert.\n\nRien d\'autre n\'a été modifié.',
  },
];
