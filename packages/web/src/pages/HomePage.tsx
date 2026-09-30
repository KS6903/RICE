import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wheat,
  Factory,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
  BarChart3,
  Users,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  LayoutDashboard,
  Settings,
  TrendingUp,
  CircleDollarSign,
  Boxes,
} from "lucide-react";
import riceLogo from "../assets/Rice_Logo.svg";

/* ------------------------------------------------------------------ */
/* Small count-up hook for the "live" stat numbers in the mock UI      */
/* ------------------------------------------------------------------ */
function useCountUp(target: number, durationMs = 1600, startDelayMs = 0) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / durationMs, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => {
      raf.current = requestAnimationFrame(step);
    }, startDelayMs);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf.current);
    };
  }, [target, durationMs, startDelayMs]);
  return value;
}

/* ------------------------------------------------------------------ */
/* Animated mock client dashboard (pure UI, fake data)                 */
/* ------------------------------------------------------------------ */
function MockStat({
  label,
  value,
  unit,
  icon: Icon,
  iconBg,
  delay,
}: {
  label: string;
  value: number;
  unit?: string;
  icon: React.ElementType;
  iconBg: string;
  delay: number;
}) {
  const n = useCountUp(value, 1800, delay);
  return (
    <div
      className="rounded-xl glass p-2.5 animate-grad-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted truncate">
            {label}
          </p>
          <p className="mt-1 text-lg font-extrabold tracking-tight text-primary">
            {n.toLocaleString()}
            {unit && (
              <span className="text-[11px] font-semibold text-secondary ml-0.5">{unit}</span>
            )}
          </p>
        </div>
        <div className={`h-8 w-8 rounded-lg ${iconBg} grid place-items-center shadow-md shrink-0`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
    </div>
  );
}

const MOCK_NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Wheat, label: "Paddy" },
  { icon: Factory, label: "Milling" },
  { icon: Package, label: "Inventory" },
  { icon: ShoppingCart, label: "Sales" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

const MOCK_ACTIVITY = [
  {
    icon: Wheat,
    text: "Paddy intake: 2,400 kg from Brgy. San Isidro",
    badge: "Procurement",
    badgeClass: "badge-green",
  },
  {
    icon: Factory,
    text: "Milling run #128 finished, 65.2% recovery",
    badge: "Milling",
    badgeClass: "badge-violet",
  },
  {
    icon: ShoppingCart,
    text: "Sale: 50 sacks premium rice to J. Santos",
    badge: "Sales",
    badgeClass: "badge-cyan",
  },
  {
    icon: Truck,
    text: "Dispatch DR-0341 out for delivery",
    badge: "Dispatch",
    badgeClass: "badge-yellow",
  },
];

function MockDashboard() {
  return (
    <div className="hp-stage relative w-full" aria-hidden>
      {/* Local keyframes: cinematic intro, looping graphs + feed */}
      <style>{`
        @keyframes hpDrawLine {
          0%        { stroke-dashoffset: 480; opacity: 0; }
          6%        { opacity: 1; }
          40%       { stroke-dashoffset: 0; opacity: 1; }
          90%       { stroke-dashoffset: 0; opacity: 1; }
          100%      { stroke-dashoffset: 480; opacity: 0; }
        }
        @keyframes hpFillFade {
          0%, 32%   { opacity: 0; }
          46%, 88%  { opacity: 1; }
          100%      { opacity: 0; }
        }
        @keyframes hpBarGrow {
          0%        { transform: scaleY(0); }
          18%       { transform: scaleY(1); }
          82%       { transform: scaleY(1); }
          100%      { transform: scaleY(0); }
        }
        @keyframes hpRowLoop {
          0%, 4%   { opacity: 0; transform: translateY(6px); }
          8%, 92%  { opacity: 1; transform: translateY(0); }
          96%, 100%{ opacity: 0; transform: translateY(-4px); }
        }
        @keyframes hpPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        /* Cinematic one-time entrance: the frame unfolds out of depth */
        @keyframes hpAssemble {
          0% {
            opacity: 0;
            transform: perspective(1400px) rotateX(13deg) rotateY(-22deg) translateZ(-160px) scale(0.9);
            filter: blur(12px);
          }
          55% { opacity: 1; filter: blur(0); }
          100% {
            opacity: 1;
            transform: perspective(1400px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1);
            filter: blur(0);
          }
        }
        /* Light glint sweeping across the glass as it locks into place */
        @keyframes hpGlint {
          0%   { opacity: 0; background-position: 175% 0; }
          22%  { opacity: 1; }
          100% { opacity: 0; background-position: -65% 0; }
        }
        @keyframes hpFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        .hp-assemble {
          animation: hpAssemble 1.15s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
        }
        .hp-float { animation: hpFloat 4s ease-in-out 1.3s infinite both; }
        .hp-glint {
          position: absolute;
          inset: 0;
          z-index: 5;
          pointer-events: none;
          background: linear-gradient(
            105deg,
            transparent 32%,
            rgba(255, 255, 255, 0.6) 48%,
            transparent 62%
          );
          background-size: 250% 100%;
          background-position: 175% 0;
          opacity: 0;
          mix-blend-mode: overlay;
          animation: hpGlint 1.2s ease-out 0.95s 1 both;
        }
        .hp-line {
          stroke-dasharray: 480;
          animation: hpDrawLine 6s ease-in-out 0.5s infinite both;
        }
        .hp-fill { animation: hpFillFade 6s ease-in-out 0.5s infinite both; }
        .hp-bar {
          transform-origin: bottom;
          animation: hpBarGrow 6s cubic-bezier(0.22, 1, 0.36, 1) infinite both;
        }
        .hp-row { animation: hpRowLoop 12s ease-in-out infinite both; }
        .hp-pulse { animation: hpPulse 2s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .hp-assemble { animation: none; opacity: 1; transform: none; filter: none; }
          .hp-glint    { animation: none; opacity: 0; }
          .hp-float    { animation: none; }
          .hp-line     { animation: none; stroke-dashoffset: 0; }
          .hp-fill     { animation: none; opacity: 1; }
          .hp-bar      { animation: none; transform: none; }
          .hp-row      { animation: none; opacity: 1; transform: none; }
          .hp-pulse    { animation: none; }
        }
      `}</style>

      <div className="hp-assemble">
        <div className="hp-float relative">
          {/* Browser frame */}
          <div className="relative rounded-2xl glass-strong shadow-2xl overflow-hidden ring-1 ring-black/5 dark:ring-white/10">
            <div className="hp-glint" />
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-soft">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <div className="ml-3 flex-1 max-w-[260px] rounded-md bg-slate-500/10 px-3 py-1 text-[10px] text-muted truncate">
                app.ricemillsystem.com/dashboard
              </div>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 hp-pulse" /> Live
              </span>
            </div>

            <div className="flex">
              {/* Mini sidebar */}
              <div className="hidden sm:flex w-36 shrink-0 flex-col gap-1 border-r border-soft p-2.5">
                <div className="flex items-center gap-1.5 px-1.5 pb-2">
                  <div className="h-5 w-5 rounded-md bg-grad-brand grid place-items-center">
                    <Wheat size={11} className="text-white" />
                  </div>
                  <span className="text-[10px] font-extrabold text-primary truncate">
                    Rice Mill 1
                  </span>
                </div>
                {MOCK_NAV.map((item, i) => (
                  <div
                    key={item.label}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium animate-grad-fade-up ${
                      item.active ? "bg-grad-brand text-white shadow-md" : "text-secondary"
                    }`}
                    style={{ animationDelay: `${150 + i * 90}ms` }}
                  >
                    <item.icon size={11} />
                    {item.label}
                  </div>
                ))}
              </div>

              {/* Main panel */}
              <div className="flex-1 p-3 space-y-2 min-w-0">
                {/* Ribbon */}
                <div
                  className="relative overflow-hidden rounded-xl p-2.5 animate-grad-fade-up"
                  style={{ animationDelay: "100ms" }}
                >
                  <div className="absolute inset-0 bg-grad-brand-anim opacity-95" />
                  <div className="relative text-white">
                    <p className="text-[10px] font-bold uppercase tracking-wide opacity-90 inline-flex items-center gap-1">
                      <Sparkles size={10} /> Today at a glance
                    </p>
                    <p className="text-sm font-extrabold mt-0.5">Good morning, Rice Mill 1 👋</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2.5">
                  <MockStat
                    label="Paddy stock"
                    value={18450}
                    unit="kg"
                    icon={Wheat}
                    iconBg="bg-gradient-to-br from-emerald-400 to-emerald-600"
                    delay={300}
                  />
                  <MockStat
                    label="Milled rice"
                    value={9320}
                    unit="kg"
                    icon={Boxes}
                    iconBg="bg-gradient-to-br from-violet-400 to-violet-600"
                    delay={450}
                  />
                  <MockStat
                    label="Sales today"
                    value={42800}
                    unit="₱"
                    icon={CircleDollarSign}
                    iconBg="bg-gradient-to-br from-cyan-400 to-cyan-600"
                    delay={600}
                  />
                  <MockStat
                    label="Net profit"
                    value={12640}
                    unit="₱"
                    icon={TrendingUp}
                    iconBg="bg-gradient-to-br from-amber-400 to-amber-600"
                    delay={750}
                  />
                </div>

                {/* Chart + bars */}
                <div className="grid grid-cols-5 gap-2.5">
                  <div
                    className="col-span-3 rounded-xl glass p-3 animate-grad-fade-up"
                    style={{ animationDelay: "500ms" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1.5">
                      Revenue, last 7 days
                    </p>
                    <svg viewBox="0 0 220 70" className="w-full h-12" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="hpStroke" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="55%" stopColor="#06b6d4" />
                          <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                      </defs>
                      <path
                        className="hp-fill"
                        d="M0,55 C20,50 35,38 55,40 C75,42 90,26 110,28 C130,30 145,14 165,18 C185,22 205,10 220,8 L220,70 L0,70 Z"
                        fill="url(#hpGrad)"
                      />
                      <path
                        className="hp-line"
                        d="M0,55 C20,50 35,38 55,40 C75,42 90,26 110,28 C130,30 145,14 165,18 C185,22 205,10 220,8"
                        fill="none"
                        stroke="url(#hpStroke)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <div
                    className="col-span-2 rounded-xl glass p-3 animate-grad-fade-up"
                    style={{ animationDelay: "650ms" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1.5">
                      Milling recovery
                    </p>
                    <div className="flex items-end justify-between gap-1.5 h-12">
                      {[62, 48, 70, 55, 78, 64, 88].map((h, i) => (
                        <div
                          key={i}
                          className="hp-bar flex-1 rounded-t-md bg-grad-brand"
                          style={{ height: `${h}%`, animationDelay: `${900 + i * 120}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Looping activity feed */}
                <div
                  className="rounded-xl glass p-2.5 animate-grad-fade-up"
                  style={{ animationDelay: "800ms" }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-2">
                    Recent activity
                  </p>
                  <div className="space-y-1">
                    {MOCK_ACTIVITY.map((a, i) => (
                      <div
                        key={i}
                        className="hp-row flex items-center gap-2"
                        style={{ animationDelay: `${1200 + i * 700}ms` }}
                      >
                        <div className="h-6 w-6 rounded-md bg-slate-500/10 grid place-items-center shrink-0">
                          <a.icon size={12} className="text-secondary" />
                        </div>
                        <p className="text-[10px] text-secondary truncate flex-1">{a.text}</p>
                        <span
                          className={`${a.badgeClass} hidden md:inline-flex !text-[9px] !px-1.5 !py-0.5`}
                        >
                          {a.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Glow under the frame */}
          <div className="absolute -inset-x-8 -bottom-10 h-24 bg-grad-brand opacity-20 blur-3xl rounded-full pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feature grid                                                        */
/* ------------------------------------------------------------------ */
const FEATURES = [
  {
    icon: Wheat,
    title: "Paddy procurement",
    desc: "Record paddy intake from farmers and traders with weights, moisture, and pricing, every kilo accounted for.",
    iconBg: "bg-gradient-to-br from-emerald-400 to-emerald-600",
  },
  {
    icon: Factory,
    title: "Milling runs",
    desc: "Track each milling batch from paddy to rice, with recovery rates and by-products computed automatically.",
    iconBg: "bg-gradient-to-br from-violet-400 to-violet-600",
  },
  {
    icon: Package,
    title: "Inventory",
    desc: "Live stock levels for paddy, milled rice, and by-products. Know exactly what's in the warehouse at all times.",
    iconBg: "bg-gradient-to-br from-cyan-400 to-cyan-600",
  },
  {
    icon: ShoppingCart,
    title: "Sales & dispatch",
    desc: "Issue sales, generate delivery records, and follow every dispatch from the mill gate to the customer.",
    iconBg: "bg-gradient-to-br from-amber-400 to-amber-600",
  },
  {
    icon: Wallet,
    title: "Expenses & P&L",
    desc: "Log operating costs and see revenue, cost of goods, and net profit roll up into a clear monthly P&L.",
    iconBg: "bg-gradient-to-br from-rose-400 to-rose-600",
  },
  {
    icon: BarChart3,
    title: "Reports",
    desc: "Production, sales, and financial reports ready when you need them, no spreadsheets required.",
    iconBg: "bg-gradient-to-br from-sky-400 to-sky-600",
  },
  {
    icon: Users,
    title: "Team & roles",
    desc: "Give your accountant, cashier, encoder, and operators their own logins with just the access they need.",
    iconBg: "bg-gradient-to-br from-indigo-400 to-indigo-600",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    desc: "Sign in with Google, optional two-factor authentication, and your mill's data kept fully separate.",
    iconBg: "bg-gradient-to-br from-teal-400 to-teal-600",
  },
];

/* ------------------------------------------------------------------ */
/* Scroll-reveal primitives — fire once when the element enters view   */
/* ------------------------------------------------------------------ */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`hp-reveal ${inView ? "hp-reveal-in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

function FeatureCard({ f, index }: { f: (typeof FEATURES)[number]; index: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`hp-reveal h-full ${inView ? "hp-reveal-in" : ""}`}
      style={{ transitionDelay: `${(index % 4) * 60}ms` }}
    >
      <div className="card hp-card !p-5 h-full">
        <div className={`h-11 w-11 rounded-xl ${f.iconBg} grid place-items-center shadow-md mb-4`}>
          <f.icon size={20} className="text-white" />
        </div>
        <h3 className="font-bold text-primary">{f.title}</h3>
        <p className="mt-1.5 text-sm text-secondary">{f.desc}</p>
      </div>
    </div>
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

  // Block text selection / copy on the public landing page.
  const blockCopy = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div
      className="min-h-screen flex flex-col select-none"
      onCopy={blockCopy}
      onCut={blockCopy}
      onContextMenu={blockCopy}
      onDragStart={blockCopy}
    >
      <style>{`
        .hp-reveal {
          opacity: 0;
          transform: translateY(22px);
          transition: opacity 640ms cubic-bezier(0.23, 1, 0.32, 1),
                      transform 640ms cubic-bezier(0.23, 1, 0.32, 1);
          will-change: opacity, transform;
        }
        .hp-reveal-in { opacity: 1; transform: none; }
        @media (hover: hover) and (pointer: fine) {
          .hp-card {
            transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1),
                        box-shadow 220ms cubic-bezier(0.23, 1, 0.32, 1);
          }
          .hp-card:hover { transform: translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hp-reveal { opacity: 1; transform: none; transition: opacity 200ms ease; }
          .hp-card:hover { transform: none; }
        }
      `}</style>
      {/* Header */}
      <header className="sticky top-0 z-20 glass-strong border-b border-soft">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <img
                src={riceLogo}
                alt="Oryza"
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <span className="text-lg font-bold tracking-tight text-primary">Oryza</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-secondary !py-2">
              Log in
            </Link>
            <Link to="/signup" className="btn-primary !py-2">
              Get started <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-14 lg:pt-20 pb-16">
          <div className="grid lg:grid-cols-[1fr_1.25fr] gap-10 items-center">
            <div className="animate-grad-fade-up">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full glass text-xs font-bold uppercase tracking-wide text-secondary mb-5">
                <Sparkles size={12} className="text-emerald-500" />
                Built for rice mills
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-primary leading-[1.1]">
                Run your rice mill, <span className="text-grad-brand">from paddy to profit.</span>
              </h1>
              <p className="mt-5 text-lg text-secondary max-w-lg">
                One simple system for procurement, milling, inventory, sales, and reports, so you
                always know what's in the warehouse and what's on the books.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/signup" className="btn-primary !px-6 !py-3 text-base">
                  Create your mill's account <ArrowRight size={18} />
                </Link>
                <Link to="/login" className="btn-secondary !px-6 !py-3 text-base">
                  Log in
                </Link>
              </div>
              <p className="mt-4 text-sm text-muted">
                Free to start · Works on any device · Sign in with Google
              </p>
            </div>

            <MockDashboard />
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
          <Reveal className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-3xl font-extrabold tracking-tight text-primary">
              Everything your mill needs, in one place
            </h2>
            <p className="mt-3 text-secondary">
              Replace the notebooks and scattered spreadsheets with a single source of truth for
              daily operations.
            </p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} f={f} index={i} />
            ))}
          </div>
        </section>

        {/* CTA band */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
          <Reveal className="relative overflow-hidden rounded-3xl p-10 lg:p-14 text-center">
            <div className="absolute inset-0 bg-grad-brand-anim opacity-95" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.2),_transparent_55%)]" />
            <div className="relative text-white">
              <h2 className="text-3xl font-extrabold tracking-tight">
                Ready to modernize your mill?
              </h2>
              <p className="mt-3 text-white/90 max-w-xl mx-auto">
                Set up your account in minutes and start tracking your first paddy intake today.
              </p>
              <Link
                to="/signup"
                className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-bold text-slate-900 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                Get started for free <ArrowRight size={18} />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-soft py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted">
          <span>© {new Date().getFullYear()} Oryza by K Systematics</span>
          <div className="flex items-center gap-4">
            <Link to="/login" className="hover:text-primary transition-colors">
              Log in
            </Link>
            <Link to="/signup" className="hover:text-primary transition-colors">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
