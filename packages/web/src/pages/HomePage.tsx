import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import riceLogo from "../assets/Rice_Logo.svg";
import "./HomePage.css";

/* ------------------------------------------------------------------ */
/* The board's price list. Every figure on this page is sample data.  */
/* ------------------------------------------------------------------ */
const PRICES = [
  { variety: "RC 222", kind: "Dry", values: [1150, 1175, 1160] },
  { variety: "RC 222", kind: "Fresh", values: [900, 920, 910] },
  { variety: "Dinorado", kind: "Dry", values: [1350, 1380, 1365] },
];

// How long one plate takes to swing up on its hooks and fall back.
const SWING_MS = 760;
const SWAP_AT_MS = 320;
const SWAP_EVERY_MS = 3800;

const peso = (n: number) => n.toLocaleString("en-PH");

/** Like a miller swapping the number plates each morning: every few seconds one
 *  plate lifts on its hooks and comes back with the next figure. Off for
 *  reduced motion, while the tab is hidden, and while the board is off screen. */
function usePlateSwaps(boardRef: React.RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState(() => PRICES.map(() => 0));
  const [swinging, setSwinging] = useState<number | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    const board = boardRef.current;
    const obs =
      board && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
          })
        : null;
    if (board && obs) obs.observe(board);

    const timers: number[] = [];
    let tick = 0;
    const interval = window.setInterval(() => {
      if (!visible || document.hidden) return;
      const plate = tick % PRICES.length;
      tick += 1;
      setSwinging(plate);
      timers.push(
        window.setTimeout(() => {
          setShown((s) => s.map((v, i) => (i === plate ? (v + 1) % PRICES[i].values.length : v)));
        }, SWAP_AT_MS),
        window.setTimeout(() => setSwinging(null), SWING_MS),
      );
    }, SWAP_EVERY_MS);

    return () => {
      window.clearInterval(interval);
      timers.forEach((t) => window.clearTimeout(t));
      obs?.disconnect();
    };
  }, [boardRef]);

  return { shown, swinging };
}

/* ------------------------------------------------------------------ */
/* Board material                                                      */
/* ------------------------------------------------------------------ */

/** The painted double frame every signboard has. */
function Frame() {
  return <span className="hp-frame" aria-hidden="true" />;
}

function Bolt({ className, turn }: { className: string; turn: number }) {
  return (
    <svg className={`hp-bolt ${className}`} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.9" fill="#b9bab3" stroke="#16150f" strokeWidth="1.5" />
      <path
        d="M3.6 7h6.8"
        stroke="#16150f"
        strokeWidth="1.7"
        strokeLinecap="round"
        transform={`rotate(${turn} 7 7)`}
      />
    </svg>
  );
}

function Bolts() {
  return (
    <>
      <Bolt className="hp-bolt-tl" turn={-24} />
      <Bolt className="hp-bolt-tr" turn={62} />
      <Bolt className="hp-bolt-bl" turn={18} />
      <Bolt className="hp-bolt-br" turn={-70} />
    </>
  );
}

/** A wire hook over a nail, the same stroke as the bolts. */
function Hook({ side }: { side: "l" | "r" }) {
  return (
    <svg className={`hp-hook hp-hook-${side}`} viewBox="0 0 12 16" aria-hidden="true">
      <circle cx="6" cy="3.2" r="2.2" fill="#b9bab3" stroke="#16150f" strokeWidth="1.3" />
      <path
        d="M3.4 16V6.6C3.4 3.1 8.6 3.1 8.6 6.6V8"
        fill="none"
        stroke="#16150f"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The iron arm a station sign hangs from, bolted to the route post. */
function Bracket() {
  return (
    <svg className="hp-bracket" viewBox="0 0 40 30" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 6h40" stroke="#16150f" strokeWidth="5" />
      <path d="M2 26L34 7" stroke="#16150f" strokeWidth="3" />
      <circle cx="4" cy="6" r="1.6" fill="#b9bab3" />
    </svg>
  );
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="hp-screen">
      <figcaption className="hp-screen-bar">
        <b>{title}</b>
        <span className="hp-sample">Sample data</span>
      </figcaption>
      {children}
    </figure>
  );
}

/** One stop on the palay's route: a sign hung off the post, what happens
 *  there, and the Oraiza screen that keeps the record. */
function Station({
  id,
  sign,
  proof,
  children,
  aside,
  screen,
}: {
  id: string;
  sign: string;
  proof: "narrow" | "mid" | "wide" | "split";
  children: React.ReactNode;
  aside?: React.ReactNode;
  screen: React.ReactNode;
}) {
  return (
    <li className="hp-station" aria-labelledby={id}>
      <div className="hp-station-head">
        <h3 id={id} className="hp-sign hp-caps">
          <Bracket />
          <Frame />
          <Bolt className="hp-bolt-ml" turn={40} />
          <Bolt className="hp-bolt-mr" turn={-15} />
          {sign}
        </h3>
        <p className="hp-station-copy">{children}</p>
      </div>
      <div className={`hp-proof hp-proof-${proof}`}>
        {aside}
        {screen}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Sample records for each station                                     */
/* ------------------------------------------------------------------ */
function PurchaseScreen() {
  return (
    <Screen title="Palay purchase · 7:42 AM">
      <div className="hp-screen-body">
        <dl className="hp-fields">
          <div>
            <dt>Supplier</dt>
            <dd>R. Santos, San Isidro</dd>
          </div>
          <div>
            <dt>Variety</dt>
            <dd>RC 222 · Dry</dd>
          </div>
          <div>
            <dt>Moisture</dt>
            <dd>14.0%</dd>
          </div>
          <div>
            <dt>Gross weight</dt>
            <dd>2,450 kg</dd>
          </div>
          <div>
            <dt>Tare: 49 sacks</dt>
            <dd>49 kg</dd>
          </div>
          <div>
            <dt>Net weight</dt>
            <dd>2,401 kg</dd>
          </div>
          <div>
            <dt>Price per cavan</dt>
            <dd>₱1,150</dd>
          </div>
          <div>
            <dt>Cavans</dt>
            <dd>48.0</dd>
          </div>
        </dl>
        <div className="hp-total">
          <span>Amount to pay</span>
          <b>₱55,223</b>
        </div>
        <p className="hp-stock-note">2,401 kg added to palay stock</p>
      </div>
    </Screen>
  );
}

const SPLIT = [
  { key: "bigas", label: "Bigas", kg: 1956 },
  { key: "ipa", label: "Ipa", kg: 630 },
  { key: "darak", label: "Darak", kg: 300 },
  { key: "binlid", label: "Binlid", kg: 114 },
];
const BATCH_IN = SPLIT.reduce((s, p) => s + p.kg, 0);

function MillingScreen() {
  return (
    <Screen title="Milling batch #128">
      <div className="hp-screen-body">
        <div className="hp-batch-head">
          <span>
            Palay in: <b>{peso(BATCH_IN)} kg</b> RC 222, 14% moisture
          </span>
          <span>Out, to scale</span>
        </div>
        <div
          className="hp-split"
          role="img"
          aria-label="Out of 3,000 kg of palay: 1,956 kg bigas, 630 kg ipa, 300 kg darak, 114 kg binlid"
        >
          {SPLIT.map((p) => (
            <div
              key={p.key}
              className={`s-${p.key}`}
              style={{ width: `${(p.kg / BATCH_IN) * 100}%` }}
            />
          ))}
        </div>
        <ul className="hp-split-legend">
          {SPLIT.map((p) => (
            <li key={p.key}>
              <i className={`s-${p.key}`} />
              {p.label}
              <b>{peso(p.kg)} kg</b>
            </li>
          ))}
        </ul>
        <div className="hp-recovery">
          <b>65.2% recovery</b>
          <span>Worked out for you: 1,956 kg of bigas from 3,000 kg of palay.</span>
        </div>
      </div>
    </Screen>
  );
}

const STOCK: { item: string; sub: string; kg: number; cavans: number | null }[] = [
  { item: "Palay", sub: "RC 222", kg: 18450, cavans: 369 },
  { item: "Palay", sub: "Dinorado", kg: 6200, cavans: 124 },
  { item: "Bigas", sub: "Premium RC 222", kg: 9320, cavans: 186.4 },
  { item: "Ipa", sub: "Rice hull", kg: 4100, cavans: null },
  { item: "Darak", sub: "Rice bran", kg: 1850, cavans: null },
  { item: "Binlid", sub: "Broken rice", kg: 640, cavans: null },
];

function StockScreen() {
  return (
    <Screen title="Stock on hand">
      <table className="hp-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Stock (kg)</th>
            <th className="num">Cavans</th>
          </tr>
        </thead>
        <tbody>
          {STOCK.map((s) => (
            <tr key={s.item + s.sub}>
              <td>
                {s.item}
                <small>{s.sub}</small>
              </td>
              <td className="num">{peso(s.kg)}</td>
              <td className="num">{s.cavans == null ? "—" : s.cavans.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Screen>
  );
}

const SALES = [
  { who: "J. Santos Trading", what: "50 sacks Premium", total: 87500, paid: 87500 },
  { who: "Aling Nena Store", what: "20 sacks Regular", total: 31000, paid: 15000 },
  { who: "Dela Cruz Bigasan", what: "35 sacks Premium", total: 61250, paid: 0 },
];

function SalesScreen() {
  return (
    <Screen title="Sales this week">
      <table className="hp-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th className="num">Total</th>
            <th className="num hide-sm">Paid</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {SALES.map((s) => {
            const status = s.paid >= s.total ? "paid" : s.paid > 0 ? "part" : "unpaid";
            return (
              <tr key={s.who}>
                <td>
                  {s.who}
                  <small>{s.what}</small>
                </td>
                <td className="num">₱{peso(s.total)}</td>
                <td className="num hide-sm">₱{peso(s.paid)}</td>
                <td>
                  <span className={`hp-badge hp-badge-${status}`}>
                    {status === "paid" ? "Paid" : status === "part" ? "Partial" : "Unpaid"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function HomePage() {
  // Always land at the top on load/reload — don't let the browser restore
  // a previous (scrolled-down) position.
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  }, []);

  const boardRef = useRef<HTMLDivElement>(null);
  const { shown, swinging } = usePlateSwaps(boardRef);
  // A real buying board says which day its prices are for.
  const today = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" });

  // Block text selection / copy on the public landing page.
  const blockCopy = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div
      className="hp"
      onCopy={blockCopy}
      onCut={blockCopy}
      onContextMenu={blockCopy}
      onDragStart={blockCopy}
    >
      <header className="hp-header">
        <div className="hp-wrap">
          <Link to="/" className="hp-brand">
            <img src={riceLogo} alt="" />
            <span className="hp-caps">Oraiza</span>
          </Link>
          <nav className="hp-nav" aria-label="Account">
            <Link to="/login" className="hp-textlink">
              Log in
            </Link>
            <Link to="/signup" className="hp-plate hp-plate-ink">
              Open an account
            </Link>
          </nav>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        <section className="hp-hero">
          <div className="hp-wrap">
            <div className="hp-board" ref={boardRef}>
              <Frame />
              <Bolts />
              <div className="hp-hero-grid">
                <div>
                  <h1 className="hp-headline hp-caps">
                    <span>Palay in.</span> <span>Bigas out.</span>{" "}
                    <span>Every kilo on the books.</span>
                  </h1>
                  <p className="hp-lede">
                    Your board out front tells farmers today's price.{" "}
                    <strong>Oraiza keeps the books behind it:</strong> every weigh-in, every milling
                    batch, what's in the bodega, what you sold, and who still owes you.
                  </p>
                  <div className="hp-actions">
                    <Link to="/signup" className="hp-plate hp-plate-red">
                      Open your mill's account <ArrowRight size={20} strokeWidth={2.5} />
                    </Link>
                    <Link to="/login" className="hp-textlink">
                      Log in
                    </Link>
                  </div>
                  <p className="hp-fineprint">Free for one branch and up to 3 users.</p>
                </div>

                <span className="hp-divider" aria-hidden="true" />

                <div className="hp-prices">
                  <h2 className="hp-prices-title hp-caps">
                    Buying palay
                    <small>
                      <span>Sample prices</span> · <span>{today}</span> ·{" "}
                      <span>1 cavan = 50 kg</span>
                    </small>
                  </h2>
                  <ul className="hp-price-rows">
                    {PRICES.map((p, i) => (
                      <li className="hp-price-row" key={p.variety + p.kind}>
                        <span className="hp-variety hp-caps">
                          {p.variety}
                          <em>{p.kind}</em>
                        </span>
                        <span className="hp-hang">
                          <span
                            className={`hp-numplate hp-cond${swinging === i ? " is-swinging" : ""}`}
                          >
                            <Hook side="l" />
                            <Hook side="r" />
                            <span className="hp-peso">₱</span>
                            {peso(p.values[shown[i]])}
                          </span>
                          <span className="hp-unit">/cavan</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="hp-board-note">
                    The price changes every morning. Oraiza keeps each day's price with each
                    delivery.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="hp-path" aria-labelledby="hp-path">
          <div className="hp-wrap">
            <h2 id="hp-path" className="hp-path-title hp-caps">
              The books behind the board
            </h2>
            <p className="hp-path-lede">
              Follow one delivery of palay through the mill, from the scale to the office. The
              screens below are Oraiza, filled with sample data.
            </p>

            <ol className="hp-route">
              <Station id="hp-weigh" sign="Weigh-in" proof="mid" screen={<PurchaseScreen />}>
                A farmer's truck comes in. Record the weight, the sacks, the moisture and your price
                per cavan. <strong>Oraiza works out the net, the cavans and the amount</strong>, and
                adds the palay to your stock.
              </Station>
              <Station id="hp-mill" sign="Milling" proof="wide" screen={<MillingScreen />}>
                Enter what went into the mill and what came out.{" "}
                <strong>Oraiza works out the recovery</strong>, and the bigas, ipa, darak and binlid
                go straight into the bodega count, ready to sell.
              </Station>
              <Station id="hp-bodega" sign="Bodega" proof="narrow" screen={<StockScreen />}>
                Know what's in the bodega without walking over to count sacks. Every purchase,
                milling batch and sale moves the count, <strong>so the figure is today's</strong>,
                not last week's.
              </Station>
              <Station
                id="hp-office"
                sign="Office"
                proof="split"
                screen={<SalesScreen />}
                aside={
                  <ul className="hp-roles" aria-label="Who logs in">
                    <li>
                      <b>Boss</b>
                      <span>Sees everything and decides what each login can open.</span>
                    </li>
                    <li>
                      <b>Your staff</b>
                      <span>
                        Cashier, encoder, accountant, mill operator: each gets their own login, with
                        only the pages you allow.
                      </span>
                    </li>
                  </ul>
                }
              >
                See what you sold, what's been paid, and <strong>who still owes you</strong>.
                Expenses and reports add up to your monthly profit and loss.
              </Station>
            </ol>
          </div>
        </section>

        <section className="hp-close" aria-labelledby="hp-start">
          <div className="hp-wrap">
            <div className="hp-board">
              <Frame />
              <Bolts />
              <h2 id="hp-start" className="hp-caps">
                Start with tomorrow's first delivery.
              </h2>
              <p>
                Setting up takes a few minutes. It's free for one branch and up to 3 users; add
                staff and branches when you need them.
              </p>
              <div className="hp-actions">
                <Link to="/signup" className="hp-plate hp-plate-red">
                  Open your mill's account <ArrowRight size={20} strokeWidth={2.5} />
                </Link>
                <Link to="/login" className="hp-textlink">
                  Log in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="hp-footer">
        <div className="hp-wrap">
          <span>© {new Date().getFullYear()} Oraiza by K Systematics</span>
          {/* The agreements a visitor is about to be bound by, reachable before
              they ever create an account. */}
          <nav aria-label="Legal">
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
