import * as React from "react";

type ShimmerProps<T extends React.ElementType = "span"> = {
  as?: T;
  duration?: number;
  spread?: number;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Shimmer<T extends React.ElementType = "span">({
  as,
  duration = 2,
  spread = 2,
  className = "",
  children,
  style,
  ...props
}: ShimmerProps<T>) {
  const Component = (as || "span") as React.ElementType;
  return (
    <Component
      className={`coden-shimmer ${className}`}
      style={{
        ["--coden-shimmer-duration" as string]: `${duration}s`,
        ["--coden-shimmer-spread" as string]: String(spread),
        ...(style as React.CSSProperties),
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
