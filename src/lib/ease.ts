/**
 * Coden motion tokens.
 *
 * These values are intentionally shared by React components and the vanilla
 * Vite pages so a sidebar, drawer and route transition feel like one product.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const SPRING_PRESS = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const;
export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

