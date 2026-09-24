import * as React from "react";
import { cn } from "../../lib/utils";
import { CODEN_LOGO_GLYPH, CODEN_LOGO_GLYPH_FILL, CODEN_LOGO_TILE_FILL, CODEN_LOGO_TILE_RADIUS } from "../../lib/coden-logo";

type CodenLogoMarkProps = React.SVGProps<SVGSVGElement> & {
  decorative?: boolean;
};

export function CodenLogoMark({ className, decorative = true, ...props }: CodenLogoMarkProps) {
  return (
    <svg
      {...props}
      data-coden-logo="mark"
      className={cn("coden-logo-mark", className)}
      viewBox="0 0 32 32"
      fill="none"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "Logo Coden"}
      focusable="false"
    >
      <rect width="32" height="32" rx={CODEN_LOGO_TILE_RADIUS} fill={CODEN_LOGO_TILE_FILL} />
      {CODEN_LOGO_GLYPH.map((d) => <path key={d} d={d} fill={CODEN_LOGO_GLYPH_FILL} />)}
    </svg>
  );
}

type CodenBrandProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  label?: string;
  showName?: boolean;
};

export function CodenBrand({ className, label = "Coden accueil", showName = true, children, ...props }: CodenBrandProps) {
  return (
    <a {...props} data-coden-logo="brand" className={cn("coden-brand", className)} aria-label={label} href={props.href || "/"}>
      <CodenLogoMark width={32} height={32} />
      {showName ? <span className="coden-wordmark">{children || "Coden"}</span> : null}
    </a>
  );
}
