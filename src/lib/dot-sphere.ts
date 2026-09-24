/**
 * A slowly turning sphere of rings, a few of them lit.
 *
 * Drawn on a canvas rather than as an image so it can turn, and so its
 * colours follow the theme: they are read from CSS custom properties on the
 * canvas (`--sphere-ring`, `--sphere-dot`), re-read now and then so a theme
 * switch reaches it without a reload.
 *
 * It costs nothing when nobody is looking: it stops off screen and in a
 * background tab, and draws a single still frame for reduced motion.
 */

type Point = { x: number; y: number; z: number; lit: boolean; phase: number };

function fibonacciSphere(count: number): Point[] {
  const points: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = golden * i;
    // Deterministic "random" so the lit dots are the same on every load.
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const noise = seed - Math.floor(seed);
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, lit: noise < 0.07, phase: noise * Math.PI * 20 });
  }
  return points;
}

export function mountDotSphere(canvas: HTMLCanvasElement, options: { count?: number; speed?: number; tilt?: number } = {}): () => void {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const points = fibonacciSphere(options.count ?? 460);
  const speed = options.speed ?? 0.00009; // radians per millisecond
  const tilt = options.tilt ?? 0.42;
  const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  let width = 0;
  let height = 0;
  let angle = 0.6;
  let last = 0;
  let frame = 0;
  let visible = true;
  let colors = { ring: 'rgba(255,255,255,.7)', dot: '#ffffff' };
  let colorAge = 0;

  const readColors = () => {
    const style = getComputedStyle(canvas);
    colors = {
      ring: style.getPropertyValue('--sphere-ring').trim() || colors.ring,
      dot: style.getPropertyValue('--sphere-dot').trim() || colors.dot,
    };
  };

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = (time: number) => {
    if (colorAge-- <= 0) { readColors(); colorAge = 90; }
    context.clearRect(0, 0, width, height);
    const radius = Math.min(width, height) * 0.48;
    const cx = width / 2;
    const cy = height / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const ring = radius * 0.034;
    context.lineWidth = Math.max(0.8, radius * 0.0032);

    for (const point of points) {
      // Turn around the vertical axis, then tilt towards the viewer.
      const x1 = point.x * cosA + point.z * sinA;
      const z1 = -point.x * sinA + point.z * cosA;
      const y2 = point.y * cosT - z1 * sinT;
      const z2 = point.y * sinT + z1 * cosT;
      if (z2 < -0.05) continue; // the far side stays hidden
      const px = cx + x1 * radius;
      const py = cy + y2 * radius;
      // A circle on the surface, seen edge-on towards the rim.
      const facing = Math.max(0.12, z2);
      const rotation = Math.atan2(y2, x1);
      const alpha = Math.min(1, 0.25 + z2 * 0.9);
      context.globalAlpha = alpha;
      if (point.lit) {
        const pulse = reduced ? 1 : 0.55 + 0.45 * Math.sin(time * 0.0016 + point.phase);
        context.save();
        context.globalAlpha = alpha * pulse;
        context.shadowColor = colors.dot;
        context.shadowBlur = ring * 3.2;
        context.fillStyle = colors.dot;
        context.beginPath();
        context.ellipse(px, py, ring * 0.9, ring * 0.9 * facing, rotation, 0, Math.PI * 2);
        context.fill();
        context.restore();
      } else {
        context.strokeStyle = colors.ring;
        context.beginPath();
        context.ellipse(px, py, ring, ring * facing, rotation, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  };

  const loop = (time: number) => {
    frame = 0;
    if (!visible || document.hidden) return;
    if (last) angle += (time - last) * speed;
    last = time;
    draw(time);
    frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (reduced || frame) return;
    last = 0;
    frame = requestAnimationFrame(loop);
  };

  resize();
  readColors();
  draw(0);

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); draw(performance.now()); }) : null;
  resizeObserver?.observe(canvas);
  const intersection = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) start();
    })
    : null;
  intersection?.observe(canvas);
  const onVisibility = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVisibility);
  start();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
