/**
 * Decides, once per dashboard load, whether to open the welcome onboarding,
 * and saves what it learns.
 *
 * The account's creation date and its answers come from the Supabase session
 * already in the browser; nothing extra is fetched. `?onboarding=1` opens it
 * on demand (and is removed from the address), for anyone who skipped it.
 */
import { supabase } from './supabase-browser';
import { readCreateProjectFlow } from '../services/create-project-flow';
import { shouldShowOnboarding, type OnboardingRecord } from './onboarding-state';
import { rememberOnboardingProfile } from '../settings-panel';

const localKey = (userId: string) => `coden.onboarding.done:${userId}`;

function readLocalDone(userId: string): boolean {
  try { return window.localStorage.getItem(localKey(userId)) === '1'; } catch { return false; }
}

function takeForcedFlag(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('onboarding') !== '1') return false;
    url.searchParams.delete('onboarding');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

export async function maybeOpenOnboarding(context: { currentPlan?: string | null; email?: string | null; localPreview?: boolean }) {
  const forced = takeForcedFlag();
  if (context.localPreview) {
    if (!forced) return;
    const { openOnboarding } = await import('../components/upgrade-flows');
    openOnboarding({ currentPlan: context.currentPlan, email: context.email, save: () => {} });
    return;
  }

  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const user = data.session?.user;
  if (!user) return;
  const record = (user.user_metadata?.coden_onboarding || null) as OnboardingRecord | null;
  const show = forced || shouldShowOnboarding({
    createdAt: user.created_at,
    record,
    locallyDone: readLocalDone(user.id),
    pendingPrompt: Boolean(readCreateProjectFlow()?.prompt),
  });
  if (!show) return;

  const { openOnboarding } = await import('../components/upgrade-flows');
  openOnboarding({
    currentPlan: context.currentPlan,
    email: context.email || user.email,
    save: async next => {
      try { window.localStorage.setItem(localKey(user.id), '1'); } catch { /* the account copy below still holds */ }
      if (next.profile) rememberOnboardingProfile(next.profile);
      await supabase.auth.updateUser({ data: { coden_onboarding: next } });
    },
  });
}
