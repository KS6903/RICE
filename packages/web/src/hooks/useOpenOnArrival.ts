import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * A page's "new …" form, opened straight away when the link that brought the
 * user here ends in `?new=1` (the dashboard's getting-started steps use it, so
 * one click lands on the form rather than on an empty table).
 *
 * The flag is dropped from the address once read, so a reload or the back
 * button doesn't keep reopening the form.
 */
export function useOpenOnArrival() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("new") === "1";
  const [open, setOpen] = useState(asked);

  useEffect(() => {
    if (!asked) return;
    // Also covers following such a link while already on the page.
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [asked, params, setParams]);

  return [open, setOpen] as const;
}
