import { describe, it, expect } from 'vitest';
import { createLandingDraft, LANDING_DRAFT_KEY } from './landing-draft';

describe('the shared Landing draft', () => {
  it('restores the draft and updates both subscribers', () => {
    const saved = new Map([[LANDING_DRAFT_KEY, 'Un calendrier']]);
    const storage = { getItem: (key: string) => saved.get(key) || null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    const draft = createLandingDraft(storage);
    expect(draft.value).toBe('Un calendrier');
    const observed: string[] = [];
    draft.subscribe(() => observed.push('hero:' + draft.value));
    draft.subscribe(() => observed.push('footer:' + draft.value));
    draft.setValue('Une boutique');
    expect(observed).toEqual(['hero:Une boutique', 'footer:Une boutique']);
    expect(createLandingDraft(storage).value).toBe('Une boutique');
  });
  it('locks synchronously across both composers and keeps the draft on failure', () => {
    const draft = createLandingDraft();
    draft.setValue('Mon projet');
    expect(draft.beginSubmit()).toBe(true);
    expect(draft.beginSubmit()).toBe(false);
    draft.releaseSubmit();
    expect(draft.value).toBe('Mon projet');
    expect(draft.beginSubmit()).toBe(true);
  });
  it('works with blocked storage and unsubscribes cleanly', () => {
    const draft = createLandingDraft({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    let calls = 0;
    const unsubscribe = draft.subscribe(() => { calls++; });
    draft.setValue('Conservé en mémoire');
    unsubscribe();
    draft.setValue('Toujours utilisable');
    expect(calls).toBe(1);
    expect(draft.value).toBe('Toujours utilisable');
  });
});
