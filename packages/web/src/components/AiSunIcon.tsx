import { t } from "../i18n";
/** The drying advice's sun, with "AI" in the middle: the advice comes from the
 *  AI advisor. Drawn like the other (lucide) icons: a 24 box, stroked in the
 *  current colour, but with a bigger disc so the letters fit. */
export default function AiSunIcon({
  size = 24,
  ...rest
}: React.ComponentPropsWithoutRef<"svg"> & { size?: number }) {
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="6.25" />
      <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6L6 6M18 18l1.4 1.4M4.6 19.4L6 18M18 6l1.4-1.4" />
      <text
        x="12"
        y="14.6"
        textAnchor="middle"
        fontSize="7"
        fontWeight="800"
        fill="currentColor"
        stroke="none"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
      >
        {t("AI")}
      </text>
    </svg>
  );
}
