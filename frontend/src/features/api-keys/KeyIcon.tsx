import type { SVGProps } from "react";

/** Key glyph matching the `@/ui` icon set (24px grid, 1.8 stroke, decorative). */
export function KeyIcon({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4M15.5 7.5l2.5 2.5M17.5 5.5l2 2" />
    </svg>
  );
}
