import { useEffect, useState } from "react";

/** True once `active` has stayed true for `ms`, and false again as soon as it
 *  isn't. A wait that is usually short then shows nothing, and only a long one
 *  says so. */
export function useAfterDelay(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}
