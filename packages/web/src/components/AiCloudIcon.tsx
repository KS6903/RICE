type IconProps = React.ComponentPropsWithoutRef<"svg"> & { size?: number };

/** Light dashes under the cloud for a drizzle, slanted streaks for rain. */
const DROPS = {
  drizzle: "M8 17.5v1M8 21v1M12.5 19v1M17 17.5v1M17 21v1",
  rain: "M8 17.5l-1 3M12.5 17.5l-1.5 4.5M17 17.5l-1 3",
} as const;

/** A rain cloud with "AI" in the cloud, for the AI advisor's drying advice,
 *  like AiSunIcon: a 24 box stroked in the current colour, the cloud raised
 *  and filled out so the letters fit, the drops underneath. */
function AiCloudIcon({ drops, size = 24, ...rest }: IconProps & { drops: keyof typeof DROPS }) {
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
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.5 15H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d={DROPS[drops]} />
      <text
        x="12"
        y="11.9"
        textAnchor="middle"
        fontSize="7"
        fontWeight="800"
        fill="currentColor"
        stroke="none"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
      >
        AI
      </text>
    </svg>
  );
}

export function AiCloudDrizzleIcon(props: IconProps) {
  return <AiCloudIcon drops="drizzle" {...props} />;
}

export function AiCloudRainIcon(props: IconProps) {
  return <AiCloudIcon drops="rain" {...props} />;
}
