import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUp } from "lucide-react";
import Markdown from "../components/Markdown";
import riceLogo from "../assets/Rice_Logo.svg";
import { legalService, type LegalDocument, type LegalIndex } from "../services/LegalService";

/** Drop a document's own leading `# Title`.
 *
 *  Every document opens with one, and the section header already shows the
 *  title, so rendering both prints it twice.
 */
function stripLeadingTitle(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (!/^#\s+/.test(lines[i] ?? "")) return markdown;
  i += 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  return lines.slice(i).join("\n");
}

/** Public legal surface: every document on one page.
 *
 *  Reachable without a session on purpose. A term nobody could read before
 *  agreeing is a weak term, and the same page has to stay reachable afterwards
 *  so a customer can check what they are bound by.
 *
 *  `/legal/:key` renders this same page scrolled to that document, so the
 *  links in signup, the acceptance gate and emails keep working.
 */
export default function LegalPage() {
  const { key } = useParams<{ key?: string }>();
  const location = useLocation();
  const [index, setIndex] = useState<LegalIndex | null>(null);
  const [docs, setDocs] = useState<LegalDocument[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    legalService
      .index()
      .then(async (idx) => {
        const all = await Promise.all(idx.documents.map((d) => legalService.document(d.key)));
        if (cancelled) return;
        setIndex(idx);
        setDocs(all);
      })
      .catch(() => {
        if (!cancelled) setError("The legal documents could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Jump to the requested document once it is on the page. Keyed on
  // location.key too, so clicking the same contents link twice still jumps.
  useEffect(() => {
    if (loading) return;
    if (key) document.getElementById(key)?.scrollIntoView?.();
    else window.scrollTo?.(0, 0);
  }, [key, location.key, loading]);

  // The floating up button: an explicit, user-triggered action, so it scrolls
  // smoothly (unlike the instant jumps above) — except for reduced motion,
  // since smooth-scroll ignores that OS setting on its own.
  const scrollToTop = () => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Only worth showing once there's real distance to close — hidden at the
  // top of the page, where it would have nothing to do.
  const [showUp, setShowUp] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowUp(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Deliberately plain: a flat surface colour, bordered boxes instead of
  // `glass`/`card`/`panel`, and no animation of any kind. The animated brand
  // gradient repainted the page every frame and every glass surface re-blurred
  // it, which on a long document someone just sits and reads is a GPU drain.
  return (
    <div className="min-h-screen bg-[rgb(var(--surface))]">
      <header className="sticky top-0 z-10 border-b border-soft bg-[rgb(var(--surface))]">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Back to Oryza">
            <div className="h-9 w-9 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <img
                src={riceLogo}
                alt="Oryza"
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <span className="text-lg font-bold tracking-tight text-primary">Oryza</span>
          </Link>
          <Link to="/" className="btn-ghost text-sm">
            <ArrowLeft size={16} />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 lg:py-12">
        {loading && <p className="text-secondary">Loading the legal documents…</p>}

        {!loading && error && (
          <div className="rounded-2xl border border-soft p-6">
            <p className="text-secondary">{error}</p>
          </div>
        )}

        {!loading && !error && index && (
          <>
            <h1 className="text-2xl font-bold text-primary">Legal</h1>
            <p className="mt-2 text-secondary">
              The agreements that govern your use of Oryza. Current agreement version{" "}
              <span className="font-semibold text-primary">{index.agreement_version}</span>.
            </p>

            <nav aria-label="Contents" className="mt-6 rounded-2xl border border-soft p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Contents</p>
              <ol className="mt-3 space-y-2">
                {docs.map((d) => (
                  <li key={d.key}>
                    <Link to={`/legal/${d.key}`} className="link font-semibold">
                      {d.title}
                    </Link>
                    <span className="text-sm text-secondary"> — {d.summary}</span>
                  </li>
                ))}
              </ol>
            </nav>

            {docs.map((d) => (
              <section
                key={d.key}
                id={d.key}
                className="mt-12 scroll-mt-24 border-t border-soft pt-8"
              >
                <h2 className="text-2xl font-bold text-primary">{d.title}</h2>
                <p className="mt-1.5 text-sm text-muted">
                  Version {d.version} · effective {d.effective_date}
                </p>
                {/* The hash is what an acceptance record stores. Publishing it
                    lets a customer confirm that the text they are reading is the
                    text they agreed to. */}
                <p className="mt-1 text-xs text-muted font-mono break-all">sha256 {d.sha256}</p>
                <div className="mt-6">
                  <Markdown source={stripLeadingTitle(d.markdown)} idPrefix={d.key} />
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {/* Floating, not in the header, so it stays out of the way until there's
          real distance to close, then follows the viewport as you scroll. */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        aria-hidden={!showUp}
        tabIndex={showUp ? 0 : -1}
        className={`fixed bottom-6 right-6 z-20 h-11 w-11 grid place-items-center rounded-xl border border-soft bg-[rgb(var(--surface))] text-secondary shadow-lg hover:text-primary hover:border-soft-strong transition duration-200 ease-out motion-reduce:transition-none ${
          showUp ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-90"
        }`}
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
}
