/** Coalesce concurrent reads only; retain no response cache after completion. */
export function createSingleFlight() {
  const pending = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = Promise.resolve()
      .then(load)
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
}
