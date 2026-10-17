import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

const reads = new AsyncLocalStorage<Map<symbol, Promise<unknown>>>();

/** Opt in only around a read request. Never retain identity across requests or writes. */
export function runWithReadContext<T>(read: () => Promise<T>): Promise<T> {
  return reads.getStore() ? read() : reads.run(new Map(), read);
}

export function memoizeReadContext<T>(key: symbol, read: () => Promise<T>): Promise<T> {
  const scope = reads.getStore();
  if (!scope) return read();
  const previous = scope.get(key);
  if (previous) return previous as Promise<T>;
  const pending = read();
  scope.set(key, pending);
  return pending;
}
