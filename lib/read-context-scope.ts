import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ReadRequestTiming } from "./read-request-timing";

type ReadScope = {
  memoized: Map<symbol, Promise<unknown>>;
  pending: Map<symbol, Map<string, Promise<unknown>>>;
  timing?: ReadRequestTiming;
};
const reads = new AsyncLocalStorage<ReadScope>();

/** Opt in only around a read request. Never retain identity across requests or writes. */
export function runWithReadContext<T>(read: () => Promise<T>, timing?: ReadRequestTiming): Promise<T> {
  return reads.getStore() ? read() : reads.run({ memoized: new Map(), pending: new Map(), timing }, read);
}

/** Diagnostic owner only; nested readers keep the outer request's authority. */
export function getReadRequestTiming(): ReadRequestTiming | undefined {
  return reads.getStore()?.timing;
}

export function memoizeReadContext<T>(key: symbol, read: () => Promise<T>): Promise<T> {
  const scope = reads.getStore();
  if (!scope) return read();
  const previous = scope.memoized.get(key);
  if (previous) return previous as Promise<T>;
  const pending = read();
  scope.memoized.set(key, pending);
  return pending;
}

/** Join concurrent raw reads only. Settled results never authorize a later read. */
export function coalesceReadInFlight<T>(key: symbol, authority: string, read: () => Promise<T>): Promise<T> {
  const scope = reads.getStore();
  if (!scope) return read();
  let requests = scope.pending.get(key);
  if (!requests) {
    requests = new Map();
    scope.pending.set(key, requests);
  }
  const previous = requests.get(authority);
  if (previous) return previous as Promise<T>;
  // Register before invoking the transport, including when it throws synchronously.
  const pending = Promise.resolve().then(read);
  requests.set(authority, pending);
  const forget = () => {
    if (requests.get(authority) === pending) requests.delete(authority);
    if (!requests.size && scope.pending.get(key) === requests) scope.pending.delete(key);
  };
  void pending.then(forget, forget);
  return pending;
}
