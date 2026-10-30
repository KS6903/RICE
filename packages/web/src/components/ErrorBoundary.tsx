import { Component, type ReactNode } from "react";
import { isStaleBuildError, reloadForNewBuild } from "../utils/staleBuild";
import { t } from "../i18n";

type State = { failed: boolean; reloading: boolean };

/** Keeps a page that cannot draw from leaving a blank white window. A tab left
 *  open across a new build asks for files that are gone: that loads the page
 *  afresh to get the new ones. Anything else shows a message and a button that
 *  does the same. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, reloading: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (isStaleBuildError(error) && reloadForNewBuild()) this.setState({ reloading: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // The page is about to be replaced: a spinner until it is.
    if (this.state.reloading) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-white p-6 dark:bg-slate-950"
          role="status"
          aria-label={t("Loading page")}
        >
          <span className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      );
    }
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-slate-950"
      >
        <p className="text-base font-semibold text-primary">
          {t("Something went wrong. Please try again.")}
        </p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          {t("Try again")}
        </button>
      </div>
    );
  }
}
