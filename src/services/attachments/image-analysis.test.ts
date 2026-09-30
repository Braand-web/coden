import { describe, expect, it } from 'vitest';
import { isDesignReference, parseImageAnalysis, renderImageAnalysis, seenSummary } from './image-analysis';

const ANSWER = JSON.stringify({
  type: 'Maquette',
  summary: 'Page d’accueil d’une app de livraison',
  layout: ['barre de navigation', 'héros', 'trois cartes de tarifs'],
  texts: ['Livré en 30 minutes'],
  palette: ['#0f172a', '#38bdf8', 'bleu', '#FFF'],
  typography: 'Inter, titres 700',
  style: 'sobre et dense',
  patterns: ['navbar', 'cartes'],
});

describe('image analysis', () => {
  it('reads the structured answer, even wrapped in prose or a code fence', () => {
    const analysis = parseImageAnalysis(`Voici l’analyse :\n\`\`\`json\n${ANSWER}\n\`\`\``);
    expect(analysis).toMatchObject({ type: 'maquette', layout: ['barre de navigation', 'héros', 'trois cartes de tarifs'] });
    // Only real hex colours are kept, upper-cased.
    expect(analysis?.palette).toEqual(['#0F172A', '#38BDF8']);
  });

  it('returns null for an answer that is not the requested shape', () => {
    expect(parseImageAnalysis('Une belle image bleue.')).toBeNull();
    expect(parseImageAnalysis('{"foo": 1}')).toBeNull();
    expect(parseImageAnalysis('{ not json }')).toBeNull();
    expect(parseImageAnalysis('')).toBeNull();
  });

  it('renders every part the agent needs to reproduce the image', () => {
    const text = renderImageAnalysis(parseImageAnalysis(ANSWER)!);
    expect(text).toContain('Mise en page (haut → bas) : barre de navigation · héros · trois cartes de tarifs.');
    expect(text).toContain('Palette estimée : #0F172A, #38BDF8.');
    expect(text).toContain('Typographie : Inter, titres 700.');
    expect(text).toContain('« Livré en 30 minutes »');
  });

  it('tells a design reference from a photograph, by type or by file name', () => {
    expect(isDesignReference(parseImageAnalysis(ANSWER))).toBe(true);
    expect(isDesignReference({ ...parseImageAnalysis(ANSWER)!, type: 'photo' }, 'plage.jpg')).toBe(false);
    expect(isDesignReference(null, 'maquette-accueil.png')).toBe(true);
    expect(isDesignReference(null, 'ui_home.png')).toBe(true);
    expect(isDesignReference(null, 'build.png')).toBe(false);
    expect(isDesignReference(null, 'quiz.jpg')).toBe(false);
  });

  it('sums up what was seen in one line for the chat', () => {
    expect(seenSummary(parseImageAnalysis(ANSWER), 'image')).toBe('Maquette · palette #0F172A, #38BDF8 · 3 sections · sobre et dense');
    expect(seenSummary(null, 'image PNG')).toBe('image PNG');
  });
});
