type IconProps = React.ComponentPropsWithoutRef<"svg"> & { size?: number };

/** A piggy bank for the Savings page, with what makes it read as one at menu size: a
 *  coin dropping into the slot on its back. A 24 box stroked in the current colour, like
 *  the menu's other icons. */
export default function PiggyBankIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Body, ear, snout and legs */}
      <path d="M19 7c-1.4 0-2.5 1-3 1.7C12.5 7.3 5 8.4 5 13.3c0 1.7.6 2.9 2 4V21h3.5v-1.7h3V21H17v-3.8c1-.5 1.7-1.2 2-2.2h2v-3.6h-2c-.2-.8-.5-1.4-1-1.9z" />
      {/* Tail */}
      <path d="M2 10.5v.7c0 1 .8 1.8 1.8 1.8H5" />
      {/* Eye */}
      <path d="M16 12h.01" />
      {/* Slot and coin */}
      <path d="M9 10.6h3.5" />
      <circle cx="10.75" cy="4" r="2" />
    </svg>
  );
}
