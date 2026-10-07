import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { CurrentBusinessContext } from "./current-context";

// Settings actions reuse the existing domain services without changing workspace
// cookies. The override exists only inside this asynchronous action, never in a
// global user/session variable or between concurrent requests.
const contextScope = new AsyncLocalStorage<CurrentBusinessContext>();
export const scopedBusinessContext = () => contextScope.getStore();
export function runInBusinessContext<T>(context: CurrentBusinessContext, action: () => Promise<T>) {
  return contextScope.run(context, action);
}
