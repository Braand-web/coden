/**
 * Coden's animated mesh: a slow, living gradient in the brand's blues and
 * cyans (never violet), rendered by Paper Shaders' mesh gradient on WebGL 2.
 *
 * Mounted behind the landing hero and the footer. It is decoration only, so it
 * never gets in the way:
 *  - loaded after the page is interactive, and faded in once it has drawn;
 *  - paused by the shader itself when off screen or in a hidden tab;
 *  - a still frame when the visitor asks for reduced motion;
 *  - lighter on phones (fewer pixels);
 *  - absent when WebGL 2 is not available — the CSS light underneath stays.
 * The palette follows the theme toggle live.
 */
export type BrandMeshVariant = 'hero' | 'footer';

type Palette = { light: string[]; dark: string[] };

const PALETTES: Record<BrandMeshVariant, Palette> = {
  // Pale in light so the dark title keeps its contrast; a deep blue stage in dark.
  hero: {
    light: ['#F5F9FF', '#CFE3FF', '#8EC0FF', '#A8EDF8', '#E6F0FF'],
    dark: ['#040C24', '#0B4FD9', '#3A83F7', '#22D3EE', '#0A2A6B'],
  },
  // Richer: the footer card is opaque, only its edges and the space above show it.
  footer: {
    light: ['#EAF3FF', '#7FB2FF', '#3A83F7', '#7FE3F5', '#F4F8FF'],
    dark: ['#050B1F', '#0B4FD9', '#2F7BFF', '#22D3EE', '#0A3FB8'],
  },
};

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function supportsWebGl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function whenIdle(run: () => void) {
  const idle = (window as any).requestIdleCallback as ((cb: () => void, options?: { timeout: number }) => number) | undefined;
  if (idle) idle(run, { timeout: 1500 });
  else window.setTimeout(run, 300);
}

/** Mounts the mesh into `host` (an empty, absolutely positioned element). Returns nothing: it manages itself. */
export function mountBrandMesh(host: HTMLElement | null, variant: BrandMeshVariant) {
  if (!host || host.dataset.meshMounted) return;
  host.dataset.meshMounted = 'pending';
  whenIdle(() => {
    if (!supportsWebGl2()) {
      host.dataset.meshMounted = 'unsupported';
      return;
    }
    void import('@paper-design/shaders').then(({ ShaderMount, meshGradientFragmentShader, getShaderColorFromString, ShaderFitOptions }) => {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const phone = window.matchMedia?.('(max-width: 720px)').matches ?? false;
      const colorsFor = (theme: 'light' | 'dark') => PALETTES[variant][theme].map(color => getShaderColorFromString(color));
      const uniformsFor = (theme: 'light' | 'dark') => {
        const colors = colorsFor(theme);
        return {
          u_colors: colors,
          u_colorsCount: colors.length,
          u_distortion: 0.8,
          u_swirl: 0.12,
          u_grainMixer: 0,
          u_grainOverlay: 0,
          u_fit: ShaderFitOptions.cover,
          u_scale: 1,
          u_rotation: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_offsetX: 0,
          u_offsetY: 0,
          u_worldWidth: 0,
          u_worldHeight: 0,
        };
      };
      let mount: InstanceType<typeof ShaderMount>;
      try {
        mount = new ShaderMount(
          host,
          meshGradientFragmentShader,
          uniformsFor(currentTheme()),
          { alpha: true, premultipliedAlpha: false, antialias: false },
          reduced ? 0 : variant === 'hero' ? 0.28 : 0.2,
          // A fixed starting point, so the first frame always looks composed.
          variant === 'hero' ? 12_000 : 48_000,
          phone ? 1 : 1.5,
          phone ? 900_000 : 1920 * 1080,
        );
      } catch {
        host.dataset.meshMounted = 'failed';
        return;
      }
      host.dataset.meshMounted = 'ready';
      // Fade in after the first frames, over the CSS light that was there first.
      window.setTimeout(() => host.classList.add('is-ready'), 120);
      new MutationObserver(() => mount.setUniforms(uniformsFor(currentTheme())))
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }).catch(() => {
      host.dataset.meshMounted = 'failed';
    });
  });
}
