/** One grain, standing upright around its own centre. Palay has its husk's
 *  pointed ends and ridge; milled rice is plumper and smooth. */
function Grain({
  x,
  y,
  turn = 0,
  milled = false,
}: {
  x: number;
  y: number;
  turn?: number;
  milled?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      {milled ? (
        <path
          d="M0-9C3.6-9 4.4-4 4.4 0 4.4 5 3 9 0 9-3 9-4.4 5-4.4 0-4.4-4-3.6-9 0-9Z"
          fill="#d1d5db"
          stroke="#9ca3af"
          strokeWidth="1.2"
        />
      ) : (
        <>
          <path
            d="M0-10C5-6 5.5 5 0 10-5.5 5-5-6 0-10Z"
            fill="#eab308"
            stroke="#a16207"
            strokeWidth="1.2"
          />
          <path d="M0-6V6" fill="none" stroke="#a16207" strokeWidth="0.9" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

/** The peso sign, drawn so it needs no font. */
function Peso({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      transform={`translate(${x} ${y})`}
      d="M-3.5 8V-8H1A4.5 4.5 0 0 1 1 1H-3.5M-7-4.8H7M-7-1.8H7"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function RicePlant() {
  return (
    <>
      <ellipse cx="48" cy="88" rx="26" ry="3.5" fill="#a7f3d0" />
      <path d="M48 87C36 72 24 64 9 60 25 58 42 67 50 82Z" fill="#22c55e" />
      <path d="M48 87C60 72 72 64 87 60 71 58 54 67 46 82Z" fill="#16a34a" />
      <path d="M47 87C40 66 30 46 21 33 36 43 47 64 51 84Z" fill="#16a34a" />
      <path d="M49 87C53 68 60 50 72 36 69 54 57 72 52 86Z" fill="#22c55e" />
      <path
        d="M48 87C47 60 46 38 50 26 54 12 70 10 80 28"
        fill="none"
        stroke="#15803d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {[
        [47, 32, 20],
        [55, 24, 6],
        [63, 21, 0],
        [71, 24, -6],
        [80, 34, -10],
      ].map(([x, y, turn]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${turn}) scale(0.62)`}>
          <Grain x={0} y={0} />
        </g>
      ))}
    </>
  );
}

function Palay() {
  return (
    <>
      <path
        d="M28 90C34 62 42 36 66 12"
        fill="none"
        stroke="#a16207"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {[
        [69, 11, 45],
        [54, 15, 5],
        [69, 26, 80],
        [43, 26, -5],
        [59, 36, 75],
        [34, 40, -12],
        [51, 48, 70],
        [28, 54, -15],
        [45, 61, 65],
      ].map(([x, y, turn]) => (
        <Grain key={`${x}-${y}`} x={x} y={y} turn={turn} />
      ))}
    </>
  );
}

function MilledRice() {
  return (
    <>
      {[
        [48, 31, 15],
        [39, 43, -35],
        [51, 44, 70],
        [61, 43, 30],
        [28, 56, 40],
        [39, 57, -70],
        [50, 56, 10],
        [62, 57, 65],
        [71, 55, -30],
        [15, 71, 60],
        [26, 69, -20],
        [37, 71, 75],
        [48, 70, -40],
        [59, 71, 55],
        [69, 70, 15],
        [81, 71, -60],
        [22, 81, 85],
        [36, 82, 80],
        [50, 82, 95],
        [64, 82, 85],
        [77, 82, 100],
      ].map(([x, y, turn]) => (
        <Grain key={`${x}-${y}`} x={x} y={y} turn={turn} milled />
      ))}
    </>
  );
}

function RiceSack() {
  return (
    <>
      <path
        d="M31 30C20 41 15 58 17 74 18 84 25 89 34 89H62C71 89 78 84 79 74 81 58 76 41 65 30Z"
        fill="#e7cfa6"
        stroke="#a67c52"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M34 29C33 22 31 15 27 9 35 13 41 8 48 11 55 8 61 13 69 9 65 15 63 22 62 29Z"
        fill="#f0dfc0"
        stroke="#a67c52"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="30" y="26" width="36" height="6" rx="3" fill="#15803d" />
      <rect
        x="29"
        y="46"
        width="38"
        height="32"
        rx="4"
        fill="#fffbeb"
        stroke="#a67c52"
        strokeWidth="1.5"
      />
      <g transform="translate(48 62) scale(0.9)">
        <Grain x={-8} y={0} turn={-18} />
        <Grain x={8} y={0} turn={18} />
      </g>
    </>
  );
}

function Profit() {
  return (
    <>
      <path
        d="M10 34 28 22 40 29 66 9M53 9H66V22"
        fill="none"
        stroke="#16a34a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9" y="46" width="60" height="34" rx="4" fill="#15803d" />
      <rect
        x="6"
        y="41"
        width="60"
        height="34"
        rx="4"
        fill="#22c55e"
        stroke="#15803d"
        strokeWidth="2"
      />
      <circle cx="36" cy="58" r="11" fill="#bbf7d0" />
      <Peso x={36} y={58} color="#15803d" />
      <circle cx="70" cy="70" r="17" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
      <circle cx="70" cy="70" r="12.5" fill="none" stroke="#d97706" strokeWidth="1.2" />
      <Peso x={70} y={70} color="#92400e" />
    </>
  );
}

const STEPS = [RicePlant, Palay, MilledRice, RiceSack, Profit];

/** Covers the sign-in or sign-up form while it is sent. It stays up until the
 *  app opens (a page load, see enterApp) or the answer comes back wrong, when it
 *  lifts off the form, which is still filled in, to show what went wrong. */
export default function AuthLoadingScreen({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-white dark:bg-slate-950"
    >
      <div className="harvest" aria-hidden>
        {STEPS.map((Step, i) => (
          <svg
            key={i}
            viewBox="0 0 96 96"
            className="harvest-step"
            style={{ animationDelay: `${i * 0.75}s` }}
          >
            <Step />
          </svg>
        ))}
      </div>
      <p className="text-base font-semibold text-primary">{label}</p>
    </div>
  );
}
