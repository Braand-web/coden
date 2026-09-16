/* ---------------------------------------------------------------------------
 * Provider marks
 *
 * These are the real brand marks, drawn from this repository rather than
 * fetched. The composer's reference implementation pulled five SVGs from
 * cdn.21st.dev on every render of the dropdown: an outbound request per icon,
 * a dependency on someone else's uptime for a control inside a paid product,
 * and nothing to show offline.
 *
 * What was here before was worse than a CDN: hand-approximated shapes that
 * looked like nothing in particular — OpenAI as a generic rosette, Anthropic
 * as an invented "A", and no `xai` case at all, so Grok 4.6 rendered with the
 * *Auto* icon and claimed to be a different product.
 *
 * Every mark below uses `currentColor` so it inherits the surface it sits on,
 * except Gemini, whose gradient is the recognisable part of it.
 * ------------------------------------------------------------------------- */
export type ProviderIconName = 'anthropic' | 'openai' | 'google' | 'moonshot' | 'xai' | 'auto' | string;

/*
 * One gradient definition, one id.
 *
 * This string is injected in several places at once (the trigger and every row
 * of the menu), so the id repeats in the document. Duplicate ids are invalid
 * HTML, but `url(#id)` resolves to the first match and every copy here is
 * byte-identical — so the mark paints correctly either way. The alternative,
 * a counter that mutates on each call, would make the output non-deterministic
 * and impossible to assert on.
 */
const GEMINI_GRADIENT_ID = 'coden-gemini-mark';

export function providerIconSvg(icon: ProviderIconName): string {
  switch (icon) {
    /*
     * Auto is not a vendor, so it does not borrow a vendor's mark. A compass
     * rose reads as "it chooses the direction", which is what Auto does.
     */
    case 'auto':
      return `
        <svg class="provider-mark provider-mark-auto" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <path d="M15.6 8.4l-2.05 5.15-5.15 2.05 2.05-5.15 5.15-2.05Z" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.15" fill="var(--provider-icon-bg, #fff)"/>
        </svg>
      `;

    case 'openai':
      return `
        <svg class="provider-mark provider-mark-openai" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4029-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
        </svg>
      `;

    case 'anthropic':
      return `
        <svg class="provider-mark provider-mark-anthropic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z"/>
        </svg>
      `;

    case 'google':
      return `
        <svg class="provider-mark provider-mark-google" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="${GEMINI_GRADIENT_ID}" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#4285F4"/>
              <stop offset=".52" stop-color="#9B72CB"/>
              <stop offset="1" stop-color="#D96570"/>
            </linearGradient>
          </defs>
          <path fill="url(#${GEMINI_GRADIENT_ID})" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81Z"/>
        </svg>
      `;

    case 'xai':
      return `
        <svg class="provider-mark provider-mark-xai" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/>
        </svg>
      `;

    /*
     * Moonshot is the one mark drawn here rather than reproduced.
     *
     * The others are the vendors' own published glyphs. This project has no
     * network access to Moonshot's brand assets at build time and this file
     * carries no copy of them, so rather than ship a wrong shape under their
     * name, the crescent below is Coden's own stand-in — recognisable as
     * "Moonshot", honest about not being their logotype.
     */
    case 'moonshot':
      return `
        <svg class="provider-mark provider-mark-moonshot" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20.6 15.35A8.15 8.15 0 0 1 9.6 4.35a8.3 8.3 0 1 0 11 11Z" fill="currentColor"/>
          <path d="m17.1 3.4.62 1.52 1.52.62-1.52.62-.62 1.52-.62-1.52-1.52-.62 1.52-.62.62-1.52Z" fill="currentColor" opacity=".75"/>
        </svg>
      `;

    /*
     * An unknown provider gets the compass, not a vendor's mark. Falling back
     * to a real logo would label a model with a company that did not make it —
     * which is exactly the defect `xai` had.
     */
    default:
      return providerIconSvg('auto');
  }
}
