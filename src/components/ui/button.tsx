import * as React from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { SPRING_PRESS } from "../../lib/ease";
import { cn } from "../../lib/utils";

export type CodenButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type CodenButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  children?: React.ReactNode;
  variant?: CodenButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
};

export const Button = React.forwardRef<HTMLButtonElement, CodenButtonProps>(function Button(
  { className, variant = "primary", loading = false, loadingLabel = "Chargement…", children, disabled, ...props },
  ref,
) {
  const styles: Record<CodenButtonVariant, string> = {
    primary: "coden-ui-button coden-ui-button-primary",
    secondary: "coden-ui-button coden-ui-button-secondary",
    ghost: "coden-ui-button coden-ui-button-ghost",
    danger: "coden-ui-button coden-ui-button-danger",
  };
  return (
    <motion.button
      ref={ref}
      type="button"
      className={cn(styles[variant], className)}
      whileTap={disabled || loading ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? loadingLabel : children}
    </motion.button>
  );
});
