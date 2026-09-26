import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, ShieldCheck, Fingerprint } from "lucide-react";
import Markdown from "../components/Markdown";
import BrandLogo from "../components/BrandLogo";
import { legalService, type LegalDocument, type LegalIndex } from "../services/LegalService";

/** Drop a document's own leading `# Title`.
 *
 *  Every document opens with one, and the page header already shows the title,
 *  so rendering both prints it twice.
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

/** Public legal surface.
 *
 *  Reachable without a session on purpose. A term nobody could read before
 *  agreeing is a weak term, and the same page has to stay reachable afterwards
 *  so a customer can check what they are bound by.
 */
export default function LegalPage() {
  const { key } = useParams<{ key?: string }>();
  const [index, setIndex] = useState<LegalIndex | null>(null);
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const load = key ? legalService.document(key) : legalService.index();
    load
      .then((data) => {
        if (cancelled) return;
        if (key) {
          setDoc(data as LegalDocument);
        } else {
          setIndex(data as LegalIndex);
        }
      })
      .catch(() => {
        if (!cancelled) setError("That document could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <div className="min-h-screen bg-grad-brand-anim">
      <header className="glass-strong sticky top-0 z-10 border-b border-soft">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Back to Oryza">
            <BrandLogo />
            <span className="font-bold text-primary">Oryza</span>
          </Link>
          <Link to="/" className="btn-ghost text-sm">
            <ArrowLeft size={16} />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 lg:py-12">
        {loading && (
          <div className="space-y-3" aria-busy="true">
            <div className="skeleton h-8 w-2/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-4/5" />
          </div>
        )}

        {!loading && error && (
          <div className="card">
            <p className="text-secondary">{error}</p>
            <Link to="/legal" className="link mt-3 inline-block">
              See all documents
            </Link>
          </div>
        )}

        {!loading && !error && !key && index && (
          <div className="animate-grad-fade-up">
            <h1 className="text-2xl font-bold text-primary">Legal</h1>
            <p className="mt-2 text-secondary">
              The agreements that govern your use of Oryza. Current agreement version{" "}
              <span className="font-semibold text-primary">{index.agreement_version}</span>.
            </p>
            <ul className="mt-6 space-y-3">
              {index.documents.map((d) => (
                <li key={d.key}>
                  <Link
                    to={`/legal/${d.key}`}
                    className="card block hover:border-soft-strong transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="icon-chip shrink-0">
                        {d.key === "privacy" ? (
                          <ShieldCheck size={18} />
                        ) : d.key === "dpa" ? (
                          <Fingerprint size={18} />
                        ) : (
                          <FileText size={18} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-primary">{d.title}</p>
                        <p className="mt-0.5 text-sm text-secondary">{d.summary}</p>
                        <p className="mt-1.5 text-xs text-muted">
                          Version {d.version} · effective {d.effective_date}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!loading && !error && key && doc && (
          <article className="animate-grad-fade-up">
            <Link to="/legal" className="link text-sm">
              All legal documents
            </Link>
            <div className="mt-3 mb-6 pb-5 border-b border-soft">
              <h1 className="text-2xl font-bold text-primary">{doc.title}</h1>
              <p className="mt-1.5 text-sm text-muted">
                Version {doc.version} · effective {doc.effective_date}
              </p>
              {/* The hash is what an acceptance record stores. Publishing it
                  lets a customer confirm that the text they are reading is the
                  text they agreed to. */}
              <p className="mt-1 text-xs text-muted font-mono break-all">sha256 {doc.sha256}</p>
            </div>
            {/* The page header already shows the title, so drop the
                document's own leading H1 rather than printing it twice. */}
            <Markdown source={stripLeadingTitle(doc.markdown)} />
          </article>
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-6 pb-12 pt-4 text-xs text-muted">
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/legal/terms" className="link">
            Terms
          </Link>
          <Link to="/legal/privacy" className="link">
            Privacy
          </Link>
          <Link to="/legal/dpa" className="link">
            Data processing
          </Link>
          <Link to="/legal/aup" className="link">
            Acceptable use
          </Link>
          <Link to="/legal/subprocessors" className="link">
            Sub-processors
          </Link>
        </nav>
      </footer>
    </div>
  );
}
