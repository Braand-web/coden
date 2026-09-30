import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appPlaybookEnabled, buildAppPlaybook, detectAppKind } from './app-playbook';

const cases: Array<[string, string]> = [
  ['Fais-moi une boutique en ligne pour vendre mes bougies avec un panier.', 'ecommerce'],
  ['Une application de réservation pour mon salon de coiffure, avec prise de rendez-vous.', 'booking'],
  ['Un CRM simple avec un pipeline de vente pour mon équipe.', 'crm'],
  ['A kanban board to manage my team tasks.', 'productivity_tool'],
  ['Un blog avec des articles et une page à propos.', 'blog_cms'],
  ['Un marketplace pour vendeurs et acheteurs de vélos.', 'marketplace'],
  ['Un outil de suivi des dépenses et un budget mensuel.', 'finance_tool'],
  ['Un jeu de mémoire avec des cartes.', 'game_interactive'],
  ['Un annuaire des restaurants de ma ville.', 'directory_listing'],
  ['Une plateforme e-learning avec des cours et des quiz.', 'education_platform'],
  ['A SaaS to manage subscriptions for my customers.', 'saas'],
];

describe('recognising a kind of app', () => {
  for (const [prompt, kind] of cases) {
    it(`reads « ${prompt.slice(0, 50)}… » as ${kind}`, () => {
      expect(detectAppKind(prompt)?.type).toBe(kind);
    });
  }

  it('recognises nothing on a bare word: « prompt », « note », « profile » in a sentence are not a kind of app', () => {
    for (const prompt of [
      'Change le texte du prompt sur la page d’accueil.',
      'Ajoute une note en bas de page pour les mentions légales.',
      'Mets une photo de profil ronde dans l’en-tête.',
      'Fais une page qui présente mon entreprise de plomberie.',
      'Make the button green.',
      '',
    ]) expect(detectAppKind(prompt), prompt).toBeNull();
  });
});

describe('the brief', () => {
  it('is short, names the screens, flows and states, and puts the person\'s words first', () => {
    const brief = buildAppPlaybook('Une application de réservation pour mon salon de coiffure.');
    expect(brief.length).toBeLessThan(1_400);
    expect(brief).toMatch(/checklist, not extra scope/);
    expect(brief).toMatch(/the user's own words always win/);
    expect(brief).toMatch(/Screens:/);
    expect(brief).toMatch(/Core flows to make really work:/);
    expect(brief).toMatch(/loading, empty, error state/);
    expect(brief).toMatch(/Done when:/);
  });

  it('never carries the backend security jargon into the coder\'s brief, and says nothing for an unclassified request', () => {
    expect(buildAppPlaybook('Un CRM avec un pipeline de vente.')).not.toMatch(/RLS|service role/i);
    expect(buildAppPlaybook('Fais une page pour mon plombier.')).toBe('');
  });

  it('is switched off by CODEN_APP_PLAYBOOK=0, and reaches the coder only on a new build', () => {
    expect(appPlaybookEnabled({})).toBe(true);
    expect(appPlaybookEnabled({ CODEN_APP_PLAYBOOK: '0' })).toBe(false);
    const pipeline = readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
    expect(pipeline).toMatch(/input\.route === 'new_project' \|\| input\.route === 'large_change'\) \? buildAppPlaybook\(input\.prompt\)/);
    expect(pipeline).toMatch(/designPolicy: \[\.\.\.\[designContractBlock, designPolicy, backendBriefing, appPlaybook\]/);
  });
});
