interface Props {
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * KS Productions brand mark. Same paths as the admin sidebar logo.
 * `className` sets the stroke color via `text-*` since stroke="currentColor".
 */
export default function BrandLogo({ width = 28, height = 14, className = "text-amber-400", strokeWidth = 6 }: Props) {
  return (
    <svg
      viewBox="80 20 145 65"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M85.6 25 H222.2 M150 30 L88 80" />
      <path d="M150 25 V80" />
      <path d="M85.6 81.1 H222.2 M220 80 L150 30" />
    </svg>
  );
}
