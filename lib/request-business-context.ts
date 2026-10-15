import "server-only";
import { cache } from "react";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { runReadWithDeadline } from "@/lib/bounded-get";

// React cache deduplicates only within the server render request; never shared
// across users. Mutation code continues to read its own fresh context.
export const getRequestBusinessContext = cache(() => runReadWithDeadline(getCurrentBusinessContext(), 12_000));
