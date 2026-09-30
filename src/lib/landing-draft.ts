/** A single draft and submission lock for the two Landing composers. */
export const LANDING_DRAFT_KEY = 'coden-landing-draft-v1';
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function createLandingDraft(storage?: DraftStorage) {
  let value = '';
  try { value = storage?.getItem(LANDING_DRAFT_KEY) || ''; } catch { /* optional storage */ }
  let busy = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    get value() { return value; },
    get busy() { return busy; },
    setValue(next: string) {
      value = next;
      try { storage?.setItem(LANDING_DRAFT_KEY, next); } catch { /* keep the live draft */ }
      notify();
    },
    beginSubmit() {
      if (busy) return false;
      busy = true;
      notify();
      return true;
    },
    releaseSubmit() { busy = false; notify(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
