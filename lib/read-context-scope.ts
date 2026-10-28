import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ReadRequestTiming } from "./read-request-timing";

type ReadScope = {
  token: object;
  controller: AbortController;
  memoized: Map<symbol, Promise<unknown>>;
  validations: Map<symbol, Map<string, Promise<unknown>>>;
  pending: Map<symbol, Map<string, Promise<unknown>>>;
  timing?: ReadRequestTiming;
};
const reads = new AsyncLocalStorage<ReadScope>();
const readAborts = new AsyncLocalStorage<AbortSignal>();
type ValidationScope = Pick<ReadScope, "validations" | "pending">;
const freshValidation = new AsyncLocalStorage<ValidationScope>();

/** Opaque request identity; never an authorization decision or cross-request cache. */
export function getReadContextToken(): object | undefined {
  return reads.getStore()?.token;
}

/** Reuse of verified rows is forbidden for explicit final revocation probes. */
export function getReusableReadValidationToken(): object | undefined {
  return freshValidation.getStore() ? undefined : getReadContextToken();
}

/** Final read validation must not join another caller's pending identity gate. */
export function runWithFreshReadValidation<T>(read: () => Promise<T>): Promise<T> {
  // Each final probe starts from empty authority cells. Its own callers may
  // share that new check; they cannot borrow the earlier page admission or
  // join a different final probe, even when both run concurrently.
  return freshValidation.run({validations:new Map(),pending:new Map()}, read);
}

/** Transport cancellation is request-local and separate from identity memoization.
 * Nested stages inherit the earliest deadline; writes never consume this signal. */
export function runWithReadAbortSignal<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  const scope = reads.getStore(), parent = getReadAbortSignal();
  // A context can already be pending in this same request's memoization cell.
  // Withdraw the request's read authority too, so that prestarted work cannot
  // continue issuing safe GETs after the context consumer times out.
  const cancel = () => scope?.controller.abort(signal.reason);
  if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
  return readAborts.run(parent ? AbortSignal.any([parent, signal]) : signal, async () => {
    try { return await read(); }
    finally { signal.removeEventListener("abort", cancel); }
  });
}

export function getReadAbortSignal(): AbortSignal | undefined {
  const request = reads.getStore()?.controller.signal, nested = readAborts.getStore();
  return request && nested ? AbortSignal.any([request, nested]) : request ?? nested;
}

/** Opt in only around a read request. Never retain identity across requests or writes. */
export function runWithReadContext<T>(read: () => Promise<T>, timing?: ReadRequestTiming): Promise<T> {
  return reads.getStore() ? read() : reads.run({ token: Object.freeze({}), controller: new AbortController(), memoized: new Map(), validations: new Map(), pending: new Map(), timing }, read);
}

/** A completed selector write starts a new read phase. Never borrow prewrite cells. */
export function runWithNewReadContext<T>(read: () => Promise<T>): Promise<T> {
  return reads.run({ token: Object.freeze({}), controller: new AbortController(), memoized: new Map(), validations: new Map(), pending: new Map() }, read);
}

/** One verified session decision per authority in this read request. Never used
 * outside an explicit read scope; final revocation checks always bypass it. */
export function memoizeReadValidation<T>(key: symbol, authority: string, read: () => Promise<T>): Promise<T> {
  const scope = freshValidation.getStore() ?? reads.getStore();
  if (!scope) return read();
  let values = scope.validations.get(key);
  if (!values) { values = new Map(); scope.validations.set(key, values); }
  const previous = values.get(authority);
  if (previous) return previous as Promise<T>;
  const pending = Promise.resolve().then(read);
  values.set(authority, pending);
  // An unavailable validation must not become a successful cached admission.
  void pending.catch(() => { if (values.get(authority) === pending) values.delete(authority); });
  return pending;
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
  const scope = freshValidation.getStore() ?? reads.getStore();
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
