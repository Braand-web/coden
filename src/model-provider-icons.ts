export type ProviderIconName = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'auto' | string;

export function providerIconSvg(icon: ProviderIconName): string {
  switch (icon) {
    case 'auto':
      return `
        <svg class="provider-mark provider-mark-auto" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8.2 18.8c-2.25 0-4.05-1.56-4.05-3.62 0-1.15.55-2.18 1.44-2.85-.48-.62-.75-1.39-.75-2.19 0-1.96 1.6-3.55 3.58-3.55.32-1.55 1.69-2.72 3.33-2.72 1.25 0 2.34.67 2.94 1.67.39-.14.8-.22 1.23-.22 1.96 0 3.55 1.59 3.55 3.55 0 .58-.14 1.12-.38 1.6 1.05.65 1.75 1.81 1.75 3.14 0 2.05-1.67 3.72-3.72 3.72h-.54" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9.2 9.35c1.3.26 2.05 1.08 2.18 2.34M15.15 8.7c-.95.4-1.47 1.14-1.55 2.22M11.25 14.85c1.1.72 2.16.72 3.18 0" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
          <path d="M17.9 4.1l.38.9.9.38-.9.38-.38.9-.38-.9-.9-.38.9-.38.38-.9Z" fill="currentColor"/>
        </svg>
      `;
    case 'openai':
      return `
        <svg class="provider-mark provider-mark-openai" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3.25a3.6 3.6 0 0 1 3.45 2.56 3.6 3.6 0 0 1 4.38 4.68 3.6 3.6 0 0 1-1.36 5.75 3.6 3.6 0 0 1-5.54 2.74 3.6 3.6 0 0 1-5.66-2.03 3.6 3.6 0 0 1-3.1-5.3 3.6 3.6 0 0 1 3.38-5.6A3.6 3.6 0 0 1 12 3.25Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/>
          <path d="M15.45 5.8 9.2 9.4v7.15M18.55 10.48l-6.55 3.77-6.32-3.65M8.7 16.72l6.1-3.54V5.95M5.45 11.66l6.45-3.7 6.35 3.65M12.92 19.02v-7.09L6.7 8.35" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
    case 'google':
      return `
        <svg class="provider-mark provider-mark-google" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20.35 12.2c0-.62-.06-1.22-.17-1.8H12v3.4h4.68a4 4 0 0 1-1.74 2.62v2.18h2.82c1.65-1.52 2.59-3.76 2.59-6.4Z" fill="#4285F4"/>
          <path d="M12 20.7c2.35 0 4.32-.78 5.76-2.1l-2.82-2.18c-.78.52-1.78.83-2.94.83-2.27 0-4.19-1.53-4.88-3.59H4.2v2.25A8.7 8.7 0 0 0 12 20.7Z" fill="#34A853"/>
          <path d="M7.12 13.66A5.23 5.23 0 0 1 6.85 12c0-.58.1-1.14.27-1.66V8.09H4.2a8.7 8.7 0 0 0 0 7.82l2.92-2.25Z" fill="#FBBC05"/>
          <path d="M12 6.75c1.28 0 2.42.44 3.32 1.3l2.5-2.5A8.36 8.36 0 0 0 12 3.3a8.7 8.7 0 0 0-7.8 4.79l2.92 2.25C7.81 8.28 9.73 6.75 12 6.75Z" fill="#EA4335"/>
        </svg>
      `;
    case 'anthropic':
      return `
        <svg class="provider-mark provider-mark-anthropic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7.15 18.5 11.9 5.5h2.15l4.8 13h-2.38l-.94-2.75H10.4l-.93 2.75H7.15Z" fill="currentColor"/>
          <path d="m11.1 13.62 1.86-5.42 1.86 5.42H11.1Z" fill="var(--provider-icon-bg, #fff)"/>
          <path d="M4.7 18.5 9.36 5.5h1.58L6.28 18.5H4.7Z" fill="currentColor" opacity=".78"/>
        </svg>
      `;
    case 'deepseek':
      return `
        <svg class="provider-mark provider-mark-deepseek" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4.2 13.1c1.55-4.2 5.18-6.68 9.48-6.68 3.15 0 5.4 1.48 6.12 3.72.55 1.72-.08 3.45-1.52 4.15-1.7.82-3.17-.28-4.76-1.38-1.56-1.08-3.25-2.16-5.62-1.05-1.28.6-2.23 1.47-3.7 1.24Z" fill="currentColor" opacity=".92"/>
          <path d="M5.05 14.42c1.75 1.78 4.16 2.88 6.93 2.88 2.74 0 5.05-.95 6.6-2.62-1.58.42-3.05-.25-4.64-1.18-1.76-1.03-3.72-2.17-6.47-.83-1.02.5-1.83 1.18-2.42 1.75Z" fill="currentColor"/>
          <circle cx="15.92" cy="9.72" r="1.05" fill="var(--provider-icon-bg, #fff)"/>
        </svg>
      `;
    case 'moonshot':
      return `
        <svg class="provider-mark provider-mark-moonshot" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M17.9 15.9A7.6 7.6 0 0 1 8.1 6.1 7.75 7.75 0 1 0 17.9 15.9Z" fill="currentColor"/>
          <path d="m16.7 4.2.55 1.35 1.35.55-1.35.55-.55 1.35-.55-1.35-1.35-.55 1.35-.55.55-1.35Zm3.1 5.25.33.82.82.33-.82.33-.33.82-.33-.82-.82-.33.82-.33.33-.82Z" fill="currentColor"/>
        </svg>
      `;
    default:
      return providerIconSvg('auto');
  }
}
