import "server-only";

import { connection } from "next/server";
import type { ReactNode } from "react";
import { ExperiencePageBoundary } from "./experience-page-boundary";

/** Place the boundary inside the leaf Activity so sibling pages keep their own state.
 * A pendingFallback must contain only public chrome: it can render while the
 * existing identity/access gate is deliberately hiding all private children. */
export function withExperiencePage<Args extends unknown[]>(Page: (...args: Args) => ReactNode | void | Promise<ReactNode | void>, options: { admin?: boolean; pendingFallback?: ReactNode } = {}) {
  return async function ExperiencePage(...args: Args) {
    await connection();
    // Compatibility redirect pages may return void; React treats it as empty.
    const content = await Page(...args) as ReactNode;
    return <ExperiencePageBoundary admin={options.admin} pendingFallback={options.pendingFallback} renderRevision={crypto.randomUUID()}>{content}</ExperiencePageBoundary>;
  };
}
