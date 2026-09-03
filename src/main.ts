// @ts-ignore
import './index.css';
import './styles/modern-shell.css';
import './styles/landing.css';
import { normalizeAiChatInputs } from './ai-chat-input-normalizer';
import { initCodenMotion } from './coden-motion';
import { initProviderModelSelectors } from './model-selector-ui';
import { initPromptInputActions } from './prompt-input-actions';
import { formatCreateProjectFlowStatus, startCreateProjectFlow } from './services/create-project-flow';
import { installPublicPageEnhancements } from './public-page-enhancements';
import { initLandingI18n, getLandingLang } from './landing-i18n';
import { initPublicPricingFlow } from './public-pricing-flow';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { getProductPositioning, type ProductLocale } from './product-positioning';
import { mountMarketingReactShell } from './surface-react';

// Helper to handle potential null elements gracefully
function getElement<T extends HTMLElement | SVGElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

function isHomeLanding(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/index.html';
}

function syncLandingPositioningMetadata(locale: ProductLocale) {
    if (!isHomeLanding()) return;
    const copy = getProductPositioning(locale);
    document.title = copy.seoTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.seoDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', copy.seoTitle);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', copy.seoDescription);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', copy.seoTitle);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', copy.seoDescription);
}

function init() {
    // The shared product chrome is critical UI. Mount it before optional
    // landing enhancements so a pricing/i18n failure cannot remove navigation.
    mountMarketingReactShell();
    initCodenMotion();
    initCodenNavigationTransitions();
    // Manual French i18n for the landing. Runs before scroll-text-reveal so the
    // manifesto is split from already-translated text.
    const landingLocale = initLandingI18n();
    syncLandingPositioningMetadata(landingLocale);
    initPublicPricingFlow();
    initThemeController();
    normalizeAiChatInputs();

    const themeBtn = getElement<HTMLButtonElement>('theme-btn');
    const curtain = getElement<HTMLDivElement>('curtain');
    const moonIcon = getElement<SVGElement>('moon-icon');
    const sunIcon = getElement<SVGElement>('sun-icon');

    // 0. Persistence & Initial Theme
    const liftCurtain = () => {
        if (curtain) curtain.classList.add('rising');
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        liftCurtain();
    } else {
        window.addEventListener('load', liftCurtain);
    }

    const savedTheme = localStorage.getItem('coden-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (moonIcon && sunIcon) {
        if (savedTheme === 'dark') {
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        } else {
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        }
    }

    let curtainBusy = false;

    // Toasts (hoisted for use in wrappers)
    const toastContainer = getElement<HTMLDivElement>('toast-container');
    function showToast(message: string) {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>${message}</span>
        `;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    const conversionStorageKey = 'coden-landing-conversion-events';
    const conversionSessionKey = 'coden-landing-conversion-session';

    function getConversionSessionId() {
        let sessionId = sessionStorage.getItem(conversionSessionKey);
        if (!sessionId) {
            sessionId = `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            sessionStorage.setItem(conversionSessionKey, sessionId);
        }
        return sessionId;
    }

    function cleanConversionMetadata(metadata: Record<string, unknown>) {
        return Object.fromEntries(
            Object.entries(metadata)
                .filter(([, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => [key, String(value).slice(0, 160)]),
        );
    }

    function trackConversionEvent(eventName: string, metadata: Record<string, unknown> = {}) {
        const safeName = eventName.trim().slice(0, 80);
        if (!safeName) return;

        const payload = {
            id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            event_name: safeName,
            session_id: getConversionSessionId(),
            page_path: window.location.pathname || '/',
            page_theme: document.documentElement.getAttribute('data-theme') || 'unknown',
            metadata: cleanConversionMetadata(metadata),
            occurred_at: new Date().toISOString(),
        };

        try {
            const previous = JSON.parse(localStorage.getItem(conversionStorageKey) || '[]');
            const events = Array.isArray(previous) ? previous.slice(-79) : [];
            events.push(payload);
            localStorage.setItem(conversionStorageKey, JSON.stringify(events));
        } catch {
            // Local analytics must never block the landing page.
        }

        try {
            (window as any).dataLayer = (window as any).dataLayer || [];
            (window as any).dataLayer.push({ event: safeName, coden_conversion: payload });
            window.dispatchEvent(new CustomEvent('coden:conversion', { detail: payload }));
        } catch {
            // Optional third-party analytics bridge.
        }

        try {
            const body = JSON.stringify(payload);
            if (navigator.sendBeacon) {
                navigator.sendBeacon('/api/landing/conversion', new Blob([body], { type: 'application/json' }));
            } else {
                void fetch('/api/landing/conversion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                }).catch(() => undefined);
            }
        } catch {
            // Backend collection is best-effort.
        }
    }

    function installLandingConversionTracking() {
        const productShell = /\/(builder|dashboard|auth|admin)\.html$/.test(window.location.pathname);
        if (productShell) return;

        trackConversionEvent('landing_view', {
            referrer: document.referrer ? new URL(document.referrer, window.location.origin).hostname : 'direct',
        });

        document.addEventListener('click', event => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-conversion-event]');
            if (!target) return;
            trackConversionEvent(target.dataset.conversionEvent || 'click', {
                place: target.dataset.conversionPlace,
                source: target.dataset.conversionSource,
                template: target.dataset.conversionTemplate,
                plan: target.dataset.conversionPlan,
                text: target.textContent?.trim().replace(/\s+/g, ' '),
            });
        });

        document.querySelectorAll<HTMLTextAreaElement>('.input-wrapper textarea').forEach(textarea => {
            let trackedFocus = false;
            textarea.addEventListener('focus', () => {
                if (trackedFocus) return;
                trackedFocus = true;
                trackConversionEvent('input_focus', { place: 'hero' });
            });
        });
    }

    function installScrollTextReveal() {
        const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-text-reveal]'));
        if (!targets.length) return;

        const entries = targets.map(target => {
            if (target.dataset.scrollRevealReady !== 'true') {
                const source = target.textContent?.trim();
                if (!source) return null;

                target.dataset.scrollRevealReady = 'true';
                target.classList.add('scroll-text-reveal');
                target.setAttribute('aria-label', source);
                target.textContent = '';

                const fragment = document.createDocumentFragment();
                source.split(/(\s+)/).forEach(part => {
                    const span = document.createElement('span');
                    if (/^\s+$/.test(part)) {
                        span.className = 'scroll-reveal-space';
                        span.textContent = part;
                    } else {
                        span.className = 'scroll-reveal-word';
                        span.textContent = part;
                    }
                    fragment.appendChild(span);
                });

                target.appendChild(fragment);
            }

            return {
                target,
                words: Array.from(target.querySelectorAll<HTMLSpanElement>('.scroll-reveal-word')),
            };
        }).filter((entry): entry is { target: HTMLElement; words: HTMLSpanElement[] } => Boolean(entry?.words.length));

        if (!entries.length) return;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            entries.forEach(({ words }) => {
                words.forEach(word => {
                    word.style.setProperty('--word-opacity', '1');
                    word.style.setProperty('--word-blur', '0px');
                    word.style.setProperty('--word-lift', '0px');
                });
            });
            return;
        }

        const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
        let revealFrame = 0;

        const updateReveal = () => {
            revealFrame = 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;

            entries.forEach(({ target, words }) => {
                const rect = target.getBoundingClientRect();
                const progress = clamp((viewportHeight * 0.82 - rect.top) / (viewportHeight * 0.54 + rect.height));
                const softness = Math.max(4, Math.ceil(words.length * 0.14));

                words.forEach((word, index) => {
                    const wordProgress = clamp((progress * words.length - index) / softness);
                    word.style.setProperty('--word-opacity', (0.18 + wordProgress * 0.82).toFixed(3));
                    word.style.setProperty('--word-blur', `${(2.8 - wordProgress * 2.8).toFixed(2)}px`);
                    word.style.setProperty('--word-lift', `${(8 - wordProgress * 8).toFixed(2)}px`);
                });
            });
        };

        const requestRevealUpdate = () => {
            if (revealFrame) return;
            revealFrame = window.requestAnimationFrame(updateReveal);
        };

        updateReveal();
        window.addEventListener('scroll', requestRevealUpdate, { passive: true });
        window.addEventListener('resize', requestRevealUpdate);
    }

    function installMarketingEnhancements() {
        const path = window.location.pathname;
        const isProductShell = /\/(builder|dashboard|auth)\.html$/.test(path);
        if (isProductShell) return;

        installScrollTextReveal();
    }

    installMarketingEnhancements();
    // FAQ is authored per page. Do not inject a generic FAQ into public surfaces:
    // duplicated questions dilute the page intent and create competing landmarks.
    installPublicPageEnhancements({ faq: false });
    installLandingConversionTracking();
    initPromptInputActions({ persistForBuilder: true });
    normalizeAiChatInputs();

    type PublicAuthState = 'unknown' | 'signed-in' | 'signed-out';
    let publicAuthState: PublicAuthState = 'unknown';
    let publicAuthCheckPromise: Promise<PublicAuthState> | null = null;

    function hasConfiguredPublicSupabase() {
        const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
        const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
        return Boolean(url && key);
    }

    function setPublicAuthCtaState(state: PublicAuthState) {
        const signedIn = state === 'signed-in';
        const fr = getLandingLang() === 'fr';
        const positioning = getProductPositioning(fr ? 'fr' : 'en');
        document.querySelectorAll<HTMLElement>('.sign-in-btn').forEach(button => {
            button.setAttribute('translate', 'no');
            button.textContent = signedIn
                ? (fr ? 'Tableau de bord' : 'Dashboard')
                : positioning.primaryCta;
            button.dataset.authState = state;
            button.setAttribute('aria-label', signedIn ? 'Open your Coden dashboard' : positioning.primaryCta);
            button.classList.toggle('is-authenticated', signedIn);
        });

    }

    async function resolvePublicAuthState(force = false): Promise<PublicAuthState> {
        if (!force && publicAuthState !== 'unknown') return publicAuthState;
        if (!force && publicAuthCheckPromise) return publicAuthCheckPromise;

        publicAuthCheckPromise = (async () => {
            try {
                if (!hasConfiguredPublicSupabase()) {
                    publicAuthState = 'signed-out';
                    setPublicAuthCtaState('signed-out');
                    return 'signed-out';
                }
                const { getVerifiedSession, supabase } = await import('./lib/supabase-browser');
                const verified = await getVerifiedSession({ allowRefresh: true });
                const nextState: PublicAuthState = verified?.user ? 'signed-in' : 'signed-out';
                publicAuthState = nextState;
                setPublicAuthCtaState(nextState);

                supabase.auth.onAuthStateChange((_event, session) => {
                    const state: PublicAuthState = session?.user ? 'signed-in' : 'signed-out';
                    publicAuthState = state;
                    setPublicAuthCtaState(state);
                });

                return nextState;
            } catch {
                publicAuthState = 'signed-out';
                setPublicAuthCtaState('signed-out');
                return 'signed-out';
            } finally {
                publicAuthCheckPromise = null;
            }
        })();

        return publicAuthCheckPromise;
    }

    function navigateWithCurtain(url: string) {
        if (curtainBusy) return;
        curtainBusy = true;
        document.documentElement.dataset.navigationState = 'leaving';
        window.location.assign(url);
    }

    void resolvePublicAuthState();

    // 1. Refactored Input Wrappers Logic (supports multiple instances)
    const wrappers = document.querySelectorAll('.input-wrapper');
    wrappers.forEach((wrapper) => {
        const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement | null;
        const submitBtn = wrapper.querySelector('.submit-btn') as HTMLButtonElement | null;
        const modelSelectBtn = wrapper.querySelector('.model-select') as HTMLDivElement | null;
        const dropdown = wrapper.querySelector('.dropdown') as HTMLDivElement | null;
        const chevron = wrapper.querySelector('#chevron-icon, svg.chevron, svg') as SVGElement | null; 
        const modelLabel = wrapper.querySelector('#current-model-label, .current-model-label, span:not(.model-label-prefix)') as HTMLSpanElement | null;
        const modelOptions = wrapper.querySelectorAll('.model-option');
        const promptModeRoot = wrapper.querySelector('.prompt-mode') as HTMLDivElement | null;
        const promptModeBtn = wrapper.querySelector('.prompt-mode-btn') as HTMLButtonElement | null;
        const promptModeLabel = wrapper.querySelector('.prompt-mode-label') as HTMLSpanElement | null;
        const promptModeOptions = wrapper.querySelectorAll('[data-prompt-mode-option]');
        type PromptMode = 'auto' | 'build' | 'plan';
        let selectedPromptMode: PromptMode = 'auto';
        
        const btnSearch = wrapper.querySelector('#btn-search, .btn-search, button[data-tooltip="Search snippets"]') as HTMLButtonElement | null;

        // Auto-resize textarea
        textarea?.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
            updateSubmit();
        });

        function updateSubmit() {
            if (!textarea || !submitBtn) return;
            const active = textarea.value.trim().length > 0;
            if (active) {
                submitBtn.classList.add('active');
            } else {
                submitBtn.classList.remove('active');
            }
        }

        function setPromptMode(mode: PromptMode) {
            selectedPromptMode = mode === 'plan' ? 'plan' : mode === 'build' ? 'build' : 'auto';
            promptModeRoot?.classList.remove('open');
            if (promptModeRoot) promptModeRoot.dataset.promptMode = selectedPromptMode;
            if (promptModeBtn) promptModeBtn.setAttribute('aria-expanded', 'false');
            if (promptModeLabel) promptModeLabel.textContent = selectedPromptMode === 'plan' ? 'Plan' : selectedPromptMode === 'build' ? 'Build' : 'Auto';
            promptModeOptions.forEach(option => {
                option.classList.toggle('active', (option as HTMLElement).dataset.promptModeOption === selectedPromptMode);
            });
        }

        setPromptMode('auto');

        promptModeBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = !promptModeRoot?.classList.contains('open');
            promptModeRoot?.classList.toggle('open', open);
            promptModeBtn.setAttribute('aria-expanded', String(open));
        });

        promptModeOptions.forEach(option => {
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                const rawMode = (option as HTMLElement).dataset.promptModeOption;
                const mode: PromptMode = rawMode === 'plan' ? 'plan' : rawMode === 'build' ? 'build' : 'auto';
                setPromptMode(mode);
            });
        });

        document.addEventListener('click', (event) => {
            if (!promptModeRoot?.contains(event.target as Node)) {
                promptModeRoot?.classList.remove('open');
                promptModeBtn?.setAttribute('aria-expanded', 'false');
            }
        });

        // Keydown actions
        textarea?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (textarea.value.trim().length > 0) {
                    handleSubmit();
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                if (textarea.value.trim().length > 0) {
                    handleSubmit();
                }
            }
        });

        async function handleSubmit() {
            if (!textarea || !submitBtn) return;
            const val = textarea.value.trim();
            if (!val) return;

            const ctaPlace = wrapper.classList.contains('marketing-prompt-card') ? 'marketing_prompt' : 'hero';
            trackConversionEvent('start_building_click', {
                place: ctaPlace,
                prompt_length: val.length,
                prompt_mode: selectedPromptMode,
            });
            if (!localStorage.getItem('coden-first-generation-started')) {
                localStorage.setItem('coden-first-generation-started', 'true');
                trackConversionEvent('first_generation_started', {
                    place: ctaPlace,
                    prompt_length: val.length,
                });
            }

            submitBtn.disabled = true;
            const btnSpan = submitBtn.querySelector('span');
            const originalBtnHtml = btnSpan?.innerHTML || '';
            if (btnSpan) btnSpan.textContent = formatCreateProjectFlowStatus('preparing', getLandingLang());
            textarea.disabled = true;
            textarea.style.opacity = '0.5';

            try {
                await startCreateProjectFlow({
                    prompt: val,
                    mode: selectedPromptMode,
                    source: 'landing',
                    projectName: val,
                }, {
                    createProject: true,
                    onStatus: status => {
                        if (btnSpan) btnSpan.textContent = formatCreateProjectFlowStatus(status, getLandingLang());
                    },
                });
            } catch (error) {
                submitBtn.disabled = false;
                textarea.disabled = false;
                textarea.style.opacity = '1';
                if (btnSpan) btnSpan.innerHTML = originalBtnHtml;
                showToast(error instanceof Error ? error.message : formatCreateProjectFlowStatus('failed', getLandingLang()));
            }
        }

        submitBtn?.addEventListener('click', handleSubmit);

        // Search template trigger
        btnSearch?.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal(`
                <div style="padding: 10px;">
                    <h3 style="margin-bottom: 20px;">Search Snippets</h3>
                    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="modal-snippet-search" placeholder="Search templates..." style="background: transparent; border: none; outline: none; color: var(--text); width: 100%; font-size: 14px;">
                    </div>
                    <div style="display: grid; gap: 12px;">
                        <div class="snippet-item" style="padding: 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: background 0.2s;">
                            <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">SaaS Dashboard Template</div>
                            <div style="font-size: 11px; color: var(--text-muted);">Responsive sidebar, light theme, Recharts integration.</div>
                            <span class="snippet-val" style="display:none;">Create a light analytics dashboard for my SaaS with real-time charts.</span>
                        </div>
                        <div class="snippet-item" style="padding: 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                            <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">Mobile App Landing Page</div>
                            <div style="font-size: 11px; color: var(--text-muted);">Animated hero, testimonials, and API-ready contact form.</div>
                            <span class="snippet-val" style="display:none;">Build a landing page for my mobile app with a hero section, features grid, and waitlist form.</span>
                        </div>
                    </div>
                </div>
            `);

            // Listen for snippet click inside modal
            setTimeout(() => {
                document.querySelectorAll('.snippet-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const val = item.querySelector('.snippet-val')?.textContent || '';
                        if (textarea) {
                            textarea.value = val;
                            updateSubmit();
                            textarea.style.height = 'auto';
                            textarea.style.height = textarea.scrollHeight + 'px';
                        }
                        closeModal();
                    });
                });
            }, 50);
        });

        // Model Select & Dropdown
        modelSelectBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!dropdown) return;
            const isOpen = dropdown.classList.contains('open');
            if (isOpen) {
                dropdown.classList.remove('open');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            } else {
                dropdown.classList.add('open');
                if (chevron) chevron.style.transform = 'rotate(180deg)';
                
                // Position adjustment for dropdown on bottom CTAs so they don't clip offscreen
                const rect = dropdown.getBoundingClientRect();
                if (rect.bottom > window.innerHeight) {
                    dropdown.style.bottom = 'calc(100% + 12px)';
                    dropdown.style.top = 'auto';
                }
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (dropdown && !dropdown.contains(target) && !modelSelectBtn?.contains(target)) {
                dropdown.classList.remove('open');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }
        });

        // Initialize display name of model
        const savedModel = localStorage.getItem('coden-selected-model') || 'auto';
        let foundModel = false;
        modelOptions.forEach(opt => {
            if ((opt as HTMLElement).dataset.id === savedModel) {
                modelOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                if (modelLabel) {
                    modelLabel.textContent = (opt as HTMLElement).dataset.name || '';
                }
                foundModel = true;
            }
        });
        if (!foundModel && modelLabel) {
            const activeOpt = wrapper.querySelector('.model-option.active') as HTMLElement;
            if (activeOpt) {
                modelLabel.textContent = activeOpt.dataset.name || 'Auto';
            }
        }

        // Add options click handler
        modelOptions.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const modelId = (opt as HTMLElement).dataset.id || 'auto';
                const modelName = (opt as HTMLElement).dataset.name || '';
                
                // Persist universally
                localStorage.setItem('coden-selected-model', modelId);
                
                // Sync all wrappers' model labels and active statuses
                document.querySelectorAll('.input-wrapper').forEach(w => {
                    const label = w.querySelector('#current-model-label, .current-model-label, span:not(.model-label-prefix)') as HTMLSpanElement | null;
                    if (label) {
                        label.textContent = modelName;
                    }
                    
                    const opts = w.querySelectorAll('.model-option');
                    opts.forEach(o => {
                        if ((o as HTMLElement).dataset.id === modelId) {
                            opts.forEach(oo => oo.classList.remove('active'));
                            o.classList.add('active');
                        }
                    });
                });

                dropdown?.classList.remove('open');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            });
        });

        // Search filtering
        const dropdownSearch = dropdown?.querySelector('.dropdown-search-input') as HTMLInputElement;
        dropdownSearch?.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
            modelOptions.forEach(opt => {
                const name = (opt as HTMLElement).dataset.name?.toLowerCase() || '';
                const desc = (opt as HTMLElement).querySelector('.opt-desc')?.textContent?.toLowerCase() || '';
                if (name.includes(query) || desc.includes(query)) {
                    (opt as HTMLElement).style.display = 'flex';
                } else {
                    (opt as HTMLElement).style.display = 'none';
                }
            });
        });
        dropdownSearch?.addEventListener('keydown', (e) => e.stopPropagation());
        dropdownSearch?.addEventListener('click', (e) => e.stopPropagation());
    });

    initProviderModelSelectors();
    normalizeAiChatInputs();

    // 7. FAQ Toggle — single answer open at a time, with aria-expanded kept in sync.
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        question?.addEventListener('click', () => {
            const willOpen = !item.classList.contains('active');
            faqItems.forEach(i => {
                i.classList.remove('active');
                i.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
            });
            if (willOpen) {
                item.classList.add('active');
                question.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Global navigation helper
    (window as any).navigate = (url: string) => {
        document.documentElement.dataset.navigationState = 'leaving';
        window.location.assign(url);
    };

    // 9. Scroll reveal with a throttled fallback for browsers where the
    // IntersectionObserver callback is delayed.
    const checkReveals = () => {
        const reveals = document.querySelectorAll('.reveal:not(.active)');
        reveals.forEach(el => {
            const rect = el.getBoundingClientRect();
            const viewHeight = window.innerHeight || document.documentElement.clientHeight;
            // Anything at or above the fold is revealed — including what the
            // reader has already scrolled past. The old bound also required
            // `rect.bottom >= -150`, so a jump to an anchor, a restored scroll
            // position or Cmd+End left every skipped section stuck at opacity 0.
            if (rect.top <= viewHeight * 1.05) {
                el.classList.add('active');
            }
        });
    };

    let revealFallbackFrame = 0;
    const requestRevealCheck = () => {
        if (revealFallbackFrame) return;
        revealFallbackFrame = window.requestAnimationFrame(() => {
            revealFallbackFrame = 0;
            checkReveals();
        });
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    document.querySelectorAll('.reveal').forEach(el => {
        revealObserver.observe(el);
    });

    // Handle scroll/resize fallbacks for high security & frame compatibility
    window.addEventListener('scroll', requestRevealCheck, { passive: true });
    window.addEventListener('resize', requestRevealCheck, { passive: true });

    // Initial check and timed safety triggers
    checkReveals();
    setTimeout(checkReveals, 50);
    setTimeout(checkReveals, 150);
    setTimeout(checkReveals, 350);
    setTimeout(checkReveals, 700);

    // Iframe or Sandboxed environment compliance to guarantee visible content
    try {
        const isIframe = window.self !== window.top;
        if (isIframe) {
            document.querySelectorAll('.reveal').forEach(el => {
                el.classList.add('active');
            });
        }
    } catch (e) {
        // Safe check for cross-origin iframe security restrictions
        document.querySelectorAll('.reveal').forEach(el => {
            el.classList.add('active');
        });
    }

    // 10. Modals & Interactivity
    const modalOverlay = getElement<HTMLDivElement>('modal-overlay');
    const modalClose = getElement<HTMLButtonElement>('modal-close');
    const modalBody = getElement<HTMLDivElement>('modal-body');

    function openModal(html: string) {
        if (!modalOverlay || !modalBody) return;
        modalBody.innerHTML = html;
        modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modalOverlay?.classList.remove('open');
        document.body.style.overflow = '';
    }

    modalClose?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    document.querySelectorAll<HTMLButtonElement>('[data-build-prompt]').forEach(button => {
        button.addEventListener('click', () => {
            const prompt = button.dataset.buildPrompt?.trim();
            const textarea = getElement<HTMLTextAreaElement>('ai-textarea');
            if (!prompt || !textarea) return;
            textarea.value = prompt;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.focus({ preventScroll: true });
            textarea.closest('.input-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('Prompt ready');
        });
    });

    // Sign in flow
    document.querySelectorAll('.sign-in-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const state = await resolvePublicAuthState();
            navigateWithCurtain(state === 'signed-in' ? '/dashboard.html' : '/auth.html');
        }, { capture: true });
    });

}

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

