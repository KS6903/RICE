import { useId, type ReactNode } from "react";
import { clsx } from "clsx";
import { t } from "../i18n";

interface Props {
  /** Whose avatar this is; used for the tooltip and the accessible label. */
  name?: string;
  /** Size, e.g. "h-9 w-9". The lines take the text colour, which defaults to
   *  the header icons' secondary colour. */
  className?: string;
}

/** The figure, back to front. Each entry is one layer: its shapes hide the
 *  lines of every layer before it, as if it were cut from paper. */
const LAYERS: ReactNode[] = [
  <rect x="28" y="35" width="8" height="11" rx="2" />, // neck
  // Squared-off shoulders that end in a sharp corner, with nothing drawn on
  // the chest. They run well past the ring so the hem never shows.
  <path d="M11.5 76 13 49.2l12-3.6q7-1.2 14 0l12 3.6 1.5 26.8z" strokeLinejoin="miter" />,
  // The head, left blank on purpose: no hair, ears, eyes or mouth.
  <ellipse cx="32" cy="28" rx="10.5" ry="11.5" />,
];

// The figure sits small in the ring (SCALE), nudged up (LIFT) so the head is
// above centre. LINE is in the badge's units; the figure's stroke is divided
// by SCALE so its lines match the ring whatever the size.
const SCALE = 0.95;
const LIFT = 4;
const LINE = 2.3;

/** A profile picture for every user: a plain head and sharp shoulders, drawn
 *  in outline in the text colour. */
export default function UserAvatar({ name, className }: Props) {
  // useId gives ":r0:"-style ids; colons don't survive inside url(#…).
  const uid = `avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // Masks are in the figure's (unscaled) units; this covers all of it.
  const area = { x: -20, y: -20, width: 104, height: 104 };

  return (
    <svg
      viewBox="0 0 64 64"
      className={clsx("shrink-0 text-secondary", className)}
      role="img"
      aria-label={name ? t("{{name}}'s profile picture", { name }) : t("Profile picture")}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name && <title>{name}</title>}
      <defs>
        <clipPath id={`${uid}-clip`}>
          <circle cx="32" cy="32" r={32 - LINE / 2} />
        </clipPath>
        {/* Layer i's mask is cut out wherever a later layer sits. */}
        {LAYERS.slice(0, -1).map((_, i) => (
          <mask key={i} id={`${uid}-m${i}`} maskUnits="userSpaceOnUse" {...area}>
            <rect {...area} fill="white" stroke="none" />
            <g fill="black" stroke="none">
              {LAYERS.slice(i + 1).map((layer, j) => (
                <g key={j}>{layer}</g>
              ))}
            </g>
          </mask>
        ))}
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <g
          transform={`translate(32 ${40 - LIFT}) scale(${SCALE}) translate(-32 -40)`}
          strokeWidth={LINE / SCALE}
        >
          {LAYERS.map((layer, i) => (
            <g key={i} mask={i < LAYERS.length - 1 ? `url(#${uid}-m${i})` : undefined}>
              {layer}
            </g>
          ))}
        </g>
      </g>
      <circle cx="32" cy="32" r={32 - LINE / 2} strokeWidth={LINE} />
    </svg>
  );
}
