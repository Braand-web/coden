/** Restore the SVG's own brand color on hover without contacting suppliers. */
export function setupConnectorColors() {
  const colors = new Map<string, Promise<string | null>>();
  for (const logo of document.querySelectorAll<HTMLImageElement>('.lp-marquee-track img')) {
    const url = new URL(logo.currentSrc || logo.src, location.href);
    if (url.origin !== location.origin) continue;
    let request = colors.get(url.pathname);
    if (!request) {
      request = fetch(url).then(async response => {
        if (!response.ok) return null;
        const svg = await response.text();
        const values = [...svg.matchAll(/(?:fill|stop-color)=["'](#[0-9a-f]{3,8})["']/gi)].map(match => match[1]);
        return values.find(color => {
          const hex = color.slice(1);
          const value = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex.slice(0, 6);
          const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
          return Math.max(...channels) - Math.min(...channels) > 24;
        }) || null;
      }).catch(() => null);
      colors.set(url.pathname, request);
    }
    void request.then(color => { if (color) logo.closest('li')?.style.setProperty('--connector-brand-color', color); });
  }
}
