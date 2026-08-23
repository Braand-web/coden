import { EASE_DRAWER, EASE_OUT, SPRING_LAYOUT, SPRING_PANEL, SPRING_PRESS } from "./ease";

export type MotionPresetName = "page-enter" | "page-exit" | "panel" | "drawer" | "modal" | "button-press" | "tab-indicator" | "toast" | "list-item" | "skeleton";

export type MotionPreferences = {
  reducedMotion: boolean;
  allowDecorativeMotion: boolean;
};

export const MOTION_PRESETS = {
  pageEnter: {
    initial: { opacity: 0, y: 8, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.28, ease: EASE_OUT },
  },
  pageExit: {
    initial: { opacity: 1, y: 0, filter: "blur(0px)" },
    animate: { opacity: 0, y: -8, filter: "blur(4px)" },
    transition: { duration: 0.2, ease: EASE_OUT },
  },
  panel: {
    transition: SPRING_PANEL,
  },
  drawer: {
    transition: { duration: 0.28, ease: EASE_DRAWER },
  },
  layout: {
    transition: SPRING_LAYOUT,
  },
  press: {
    whileTap: { scale: 0.98 },
    transition: SPRING_PRESS,
  },
  modal: {
    transition: { duration: 0.32, ease: EASE_DRAWER },
  },
  toast: {
    transition: { duration: 0.2, ease: EASE_OUT },
  },
  listItem: {
    transition: { duration: 0.22, ease: EASE_OUT },
  },
  skeleton: {
    transition: { duration: 1.6, ease: EASE_OUT },
  },
} as const;
