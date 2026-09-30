import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { tailwindConfigScript } from './preview-embedding.ts';
import { STARTERS } from './sandbox/starters.ts';

/** Runs the script the way the preview document does, with the CDN's `tailwind` global present. */
function run(script: string | null) {
  expect(script).toBeTruthy();
  const warnings: string[] = [];
  const window: any = { tailwind: {} };
  vm.runInNewContext(script!, { window, console: { warn: (...args: unknown[]) => warnings.push(args.join(' ')) } });
  return { config: window.tailwind.config, warnings };
}

const starterConfig = STARTERS['react-vite'].files.find(file => file.path === 'tailwind.config.js')!.content;

describe('Tailwind config in the saved preview', () => {
  it("applies the starter's own theme — the one a plain-literal parser refused", () => {
    const { config, warnings } = run(tailwindConfigScript(starterConfig));
    expect(warnings).toEqual([]);
    // The tokens the app's components are written against.
    expect(config.theme.extend.colors.surface).toBe('color-mix(in oklch, var(--color-surface) calc(<alpha-value> * 100%), transparent)');
    expect(config.theme.extend.colors.accent).toContain('var(--color-accent)');
    expect(config.theme.extend.borderRadius.card).toBe('var(--radius-card)');
    expect(config.theme.extend.boxShadow.card).toBe('var(--shadow-card)');
    expect(config.theme.extend.fontFamily.display[0]).toContain('var(--font-display');
    expect(config.darkMode).toEqual(['class', '[data-theme="light"]']);
    // What a CDN cannot use is dropped rather than left to fail.
    expect(config.plugins).toEqual([]);
    expect(config.content).toBeUndefined();
  });

  it('reads a TypeScript config with type imports, a plugin import and satisfies', () => {
    const { config, warnings } = run(tailwindConfigScript(`
      import type { Config } from 'tailwindcss';
      import animate from 'tailwindcss-animate';
      import { fontFamily } from 'tailwindcss/defaultTheme';
      const brand: Config['theme'] = { colors: { brand: '#ac4132' } };
      const config = {
        content: ['./src/**/*.tsx'],
        theme: { extend: { colors: brand.colors, fontFamily: { sans: ['Inter', ...fontFamily.sans] } } },
        plugins: [animate],
      } satisfies Config;
      export default config;
    `));
    expect(warnings).toEqual([]);
    expect(config.theme.extend.colors.brand).toBe('#ac4132');
    expect(config.theme.extend.fontFamily.sans).toEqual(['Inter']);
    expect(config.plugins).toEqual([]);
  });

  it('reads a CommonJS config that requires its plugins and default theme', () => {
    const { config, warnings } = run(tailwindConfigScript(`
      const defaultTheme = require('tailwindcss/defaultTheme');
      module.exports = {
        theme: { extend: { fontFamily: { sans: ['Manrope', ...defaultTheme.fontFamily.sans] }, colors: { ink: '#123' } } },
        plugins: [require('@tailwindcss/typography')],
      };
    `));
    expect(warnings).toEqual([]);
    expect(config.theme.extend.colors.ink).toBe('#123');
    expect(config.theme.extend.fontFamily.sans).toEqual(['Manrope']);
  });

  it('falls back to the plain theme when the config cannot be evaluated', () => {
    const { config, warnings } = run(tailwindConfigScript(`
      export default { theme: { extend: { colors: { brand: '#ac4132' } } }, plugins: [ definitelyNotDefined.nope.nope() ] };
    `));
    expect(warnings.join(' ')).toContain('could not be evaluated');
    expect(config.theme.extend.colors.brand).toBe('#ac4132');
  });

  it('never lets config text end the script element or break the document', () => {
    const script = tailwindConfigScript(`
      // </script><script>alert('escaped')</script>  <!--
      export default { theme: { extend: { content: { marker: '</script><!-- <script>' } } } };
    `)!;
    expect(script).not.toMatch(/<\/script/i);
    expect(script).not.toContain('<!--');
    const { config, warnings } = run(script);
    expect(warnings).toEqual([]);
    expect(config.theme.extend.content.marker).toBe('</script><!-- <script>');
  });

  it('has nothing to say for an empty or non-exporting file', () => {
    expect(tailwindConfigScript('')).toBeNull();
    expect(tailwindConfigScript(null)).toBeNull();
    expect(tailwindConfigScript('const notAConfig = 1;')).toBeNull();
  });
});
