/** Deduplicate concurrent executions while allowing a later retry after settle. */
export function createSingleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;

  return () => {
    if (!pending) {
      pending = task().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}
