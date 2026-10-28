import "server-only";
import { runWithReadContext } from "./read-context-scope";

// These compile-pinned handlers only read Booking plugin settings. This list
// selects request-local deduplication, never permissions or handler dispatch.
// Do not infer read safety from an action name or invalidation metadata.
const getters = new Set([
  "action.efc196d40c1355cb97795327", // loadBookingDepositAction
  "action.d14797e33bdffa7d9940f9f4", // loadBookingRulesSettingsAction
  "action.71559420db869529e30eabcb", // loadBookSmsSettingsAction
]);

export function runWithAppLocalGetterReadScope<T>(name: string, read: () => Promise<T>): Promise<T> {
  return getters.has(name) ? runWithReadContext(read) : read();
}
