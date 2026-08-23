export type CodenSurface = "marketing" | "auth" | "pricing" | "checkout" | "dashboard" | "settings" | "builder" | "admin";

export type SurfaceConfig = {
  id: CodenSurface;
  rootSelector: string;
  theme: "coden-forge";
  supportsPageTransition: boolean;
  requiresAuth: boolean;
  mobileStrategy: "responsive" | "drawer" | "bottom-sheet";
};

export const CODEN_SURFACES: Record<CodenSurface, SurfaceConfig> = {
  marketing: { id: "marketing", rootSelector: "[data-coden-surface='marketing']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: false, mobileStrategy: "responsive" },
  auth: { id: "auth", rootSelector: "[data-coden-surface='auth']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: false, mobileStrategy: "responsive" },
  pricing: { id: "pricing", rootSelector: "[data-coden-surface='pricing']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: false, mobileStrategy: "responsive" },
  checkout: { id: "checkout", rootSelector: "[data-coden-surface='checkout']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: false, mobileStrategy: "bottom-sheet" },
  dashboard: { id: "dashboard", rootSelector: "[data-coden-surface='dashboard']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: true, mobileStrategy: "drawer" },
  settings: { id: "settings", rootSelector: "[data-coden-surface='settings']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: true, mobileStrategy: "drawer" },
  builder: { id: "builder", rootSelector: "[data-coden-surface='builder']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: true, mobileStrategy: "drawer" },
  admin: { id: "admin", rootSelector: "[data-coden-surface='admin']", theme: "coden-forge", supportsPageTransition: true, requiresAuth: true, mobileStrategy: "drawer" },
};

export function getSurfaceFromDocument(): SurfaceConfig | null {
  const id = document.body.dataset.codenSurface as CodenSurface | undefined;
  return id ? CODEN_SURFACES[id] || null : null;
}
