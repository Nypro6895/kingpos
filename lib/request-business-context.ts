import "server-only";
import { cache } from "react";
import { getCurrentBusinessContext } from "@/lib/current-context";

// React cache deduplicates only within the server render request; never shared
// across users. Mutation code continues to read its own fresh context.
export const getRequestBusinessContext = cache(() => getCurrentBusinessContext());
