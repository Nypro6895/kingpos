import "server-only";
import { cache } from "react";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { runReadWithDeadline } from "@/lib/bounded-get";
import { runWithReadAbortSignal } from "@/lib/read-context-scope";
import { scopedBusinessContext } from "./scoped-business-context";

// React cache deduplicates only within the server render request; never shared
// across users. Mutation code continues to read its own fresh context.
const readRequestBusinessContext = cache(() => runReadWithDeadline(signal => runWithReadAbortSignal(signal, () => getCurrentBusinessContext()), 12_000));
export function getRequestBusinessContext() {
  const selected = scopedBusinessContext();
  return selected ? Promise.resolve(selected) : readRequestBusinessContext();
}
