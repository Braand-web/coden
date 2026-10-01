/**
 * Coden's animated mesh: a slow, living gradient in the brand's blues and
 * cyans (never violet), rendered by Paper Shaders' mesh gradient on WebGL 2.
 *
 * Mounted behind several landing sections (hero, product, pricing, final call to action). It is decoration only, so it
 * never gets in the way:
 *  - loaded after the page is interactive, and faded in once it has drawn;
 *  - paused by the shader itself when off screen or in a hidden tab;
 *  - a still frame when the visitor asks for reduced motion;
 *  - lighter on phones (fewer pixels);
 *  - absent when WebGL 2 is not available — the CSS light underneath stays.
 * The palette follows the theme toggle live.
 *
 * It also answers the visitor: the colours lean toward the pointer (or a touch)
 * and swirl harder near it, a click sends a ripple through the gradient, and
 * everything eases back to rest when the pointer leaves. Not with reduced motion.
 */
export type BrandMeshVariant = 'hero' | 'soft' | 'footer';

type Palette = { light: string[]; dark: string[] };

const PALETTES: Record<BrandMeshVariant, Palette> = {
  // Pale in light so the dark title keeps its contrast; a deep blue stage in dark.
  hero: {
    light: ['#F5F9FF', '#CFE3FF', '#8EC0FF', '#A8EDF8', '#E6F0FF'],
    dark: ['#040C24', '#0B4FD9', '#3A83F7', '#22D3EE', '#0A2A6B'],
  },
  // Quieter, for the middle sections: a wash of colour that never competes with the content.
  soft: {
    light: ['#FAFCFF', '#DCEAFF', '#B5D6FF', '#CBF3FA', '#F0F6FF'],
    dark: ['#050B1F', '#0A3FB8', '#1F5FD6', '#157C95', '#071A4A'],
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

type Rest = { u_originX: number; u_originY: number; u_swirl: number; u_distortion: number };

/** Eases the mesh toward the pointer. The loop only runs while something is still moving. */
function bindPointer(host: HTMLElement, apply: (uniforms: Rest) => void, rest: Rest) {
  const restState: Rest = { u_originX: rest.u_originX, u_originY: rest.u_originY, u_swirl: rest.u_swirl, u_distortion: rest.u_distortion };
  const now: Rest = { ...restState };
  const target: Rest = { ...restState };
  let pulse = 0;
  let frame = 0;
  let visible = true;
  const tick = () => {
    frame = 0;
    pulse *= 0.93;
    if (pulse < 0.002) pulse = 0;
    let moving = pulse > 0;
    (Object.keys(now) as (keyof Rest)[]).forEach(key => {
      const goal = key === 'u_distortion' ? target[key] + pulse * 0.9 : key === 'u_swirl' ? target[key] + pulse * 0.6 : target[key];
      const delta = goal - now[key];
      if (Math.abs(delta) > 0.002) { now[key] += delta * 0.08; moving = true; } else now[key] = goal;
    });
    apply({ ...now });
    if (moving) frame = requestAnimationFrame(tick);
  };
  const wake = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); };
  const point = (event: PointerEvent) => {
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const lean = (event: PointerEvent) => {
    const at = point(event);
    if (!at) return leave();
    target.u_originX = 0.5 + (at.x - 0.5) * 0.9;
    target.u_originY = 0.5 + (at.y - 0.5) * 0.9;
    target.u_swirl = restState.u_swirl + 0.35;
    target.u_distortion = restState.u_distortion + 0.25;
    wake();
  };
  const leave = () => {
    Object.assign(target, restState);
    wake();
  };
  window.addEventListener('pointermove', lean, { passive: true });
  window.addEventListener('pointerdown', event => { if (point(event)) { lean(event); pulse = 1; wake(); } }, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) wake(); }).observe(host);
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
          reduced ? 0 : variant === 'hero' ? 0.28 : variant === 'soft' ? 0.16 : 0.2,
          // A fixed starting point, so the first frame always looks composed.
          variant === 'hero' ? 12_000 : variant === 'soft' ? 30_000 : 48_000,
          phone ? 1 : 1.5,
          phone ? 900_000 : 1920 * 1080,
        );
      } catch {
        host.dataset.meshMounted = 'failed';
        return;
      }
      host.dataset.meshMounted = 'ready';
      if (!reduced) bindPointer(host, (uniforms) => mount.setUniforms(uniforms), uniformsFor(currentTheme()));
      // Fade in after the first frames, over the CSS light that was there first.
      window.setTimeout(() => host.classList.add('is-ready'), 120);
      new MutationObserver(() => mount.setUniforms(uniformsFor(currentTheme())))
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }).catch(() => {
      host.dataset.meshMounted = 'failed';
    });
  });
}
