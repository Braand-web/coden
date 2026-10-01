/**
 * The first build, for someone who has never had one.
 *
 * Measured on Coden's own data: of the people who tried to build, most did not get a finished app, and the ones who
 * did got it in about two minutes. The gap is not speed, it is the first attempt — a request too vague, a wait with
 * no idea how long, a page closed too early. So the guide says what makes a good first request, says how long it
 * takes and that the work goes on if the page is closed, and — when it works — says what to do next.
 *
 * Kept per browser (localStorage); with storage blocked everything simply does not show.
 */
const GUIDE_KEY = 'coden-first-run-guide';
const BUILD_KEY = 'coden-first-build';

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked: the guide just shows again */ }
}

export const guideDismissed = () => read(GUIDE_KEY) === 'dismissed';
export const dismissGuide = () => write(GUIDE_KEY, 'dismissed');

/** True until the person has seen their first build succeed. */
export const firstBuildPending = () => read(BUILD_KEY) !== 'done';
export const markFirstBuildDone = () => write(BUILD_KEY, 'done');

export const FIRST_STEPS = [
  { title: 'Décrivez votre idée', text: 'Ce que fait l’application, pour qui, et les deux ou trois écrans ou fonctions qui comptent.' },
  { title: 'Coden la construit', text: 'Comptez 2 à 4 minutes. Vous pouvez fermer la page : le travail continue et vous le retrouvez dans vos projets.' },
  { title: 'Modifiez, publiez, partagez', text: 'Demandez des changements en une phrase, publiez en un clic, ou envoyez un lien pour que quelqu’un en fasse sa copie.' },
] as const;

export const FIRST_TIPS = [
  'Commencez petit : une seule idée claire se construit plus vite et mieux. Vous ajouterez le reste ensuite.',
  'Dites pour qui c’est et ce que la personne doit pouvoir faire.',
  'Un mot sur le style (sobre, chaleureux, sombre…) suffit : Coden choisit le reste.',
] as const;

export const FIRST_BUILD_EXPECTATION = 'Première création : comptez 2 à 4 minutes. Vous pouvez fermer cette page, le travail continue et vous le retrouverez dans vos projets.';
export const FIRST_SUCCESS_TEXT = 'Votre première application est prête. Voici la suite : changez-la en une phrase, publiez-la, ou envoyez un lien pour qu’on en fasse sa copie.';

/** After this long, a first build is told it is taking longer than usual (the median build takes about two minutes). */
export const FIRST_BUILD_SLOW_MS = 4 * 60_000;
export const FIRST_BUILD_SLOW = 'Cela prend plus de temps que d’habitude. Le travail continue : vous pouvez attendre ici, ou fermer la page et le retrouver dans vos projets.';

export const FIRST_BUILD_FAILED = 'Cette première construction n’a pas abouti. Votre demande est conservée. Une version plus simple d’abord réussit plus souvent : vous ajouterez le reste ensuite.';

/** The same request, asked to start small: one main screen, a few functions, nothing more. */
export function simplerRetryPrompt(prompt: string, french: boolean): string {
  const base = String(prompt || '').trim();
  const note = french
    ? 'Fais d’abord une première version volontairement simple : l’écran principal et une ou deux fonctions essentielles, sans options en plus. On complétera ensuite.'
    : 'Make a deliberately simple first version first: the main screen and one or two essential features, with no extras. We will add the rest afterwards.';
  return base.includes(note) ? base : `${base}\n\n${note}`;
}
