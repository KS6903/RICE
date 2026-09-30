import { useId } from "react";

interface Props {
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
  /** Stroke with the brand gradient (emerald → cyan → violet, as .bg-grad-brand)
   *  instead of the text colour. */
  gradient?: boolean;
}

/**
 * KS Productions brand mark. Same paths as the admin sidebar logo.
 * `className` sets the stroke color via `text-*` since stroke="currentColor",
 * unless `gradient` is set.
 */
export default function BrandLogo({
  width = 28,
  height = 14,
  className = "text-amber-400",
  strokeWidth = 6,
  gradient = false,
}: Props) {
  // useId gives ":r0:"-style ids; colons don't survive inside url(#…).
  const gradientId = `brand-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="80 20 145 65"
      width={width}
      height={height}
      fill="none"
      stroke={gradient ? `url(#${gradientId})` : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {gradient && (
        <defs>
          {/* userSpaceOnUse over the viewBox, so the three strokes share one
              sweep instead of each restarting the gradient. */}
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="80"
            y1="20"
            x2="225"
            y2="85"
          >
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="55%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      )}
      <path d="M85.6 25 H222.2 M150 30 L88 80" />
      <path d="M150 25 V80" />
      <path d="M85.6 81.1 H222.2 M220 80 L150 30" />
    </svg>
  );
}
