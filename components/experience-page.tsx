import "server-only";

import { connection } from "next/server";
import type { ReactNode } from "react";
import { ExperiencePageBoundary } from "./experience-page-boundary";

/** Place the boundary inside the leaf Activity so sibling pages keep their own state. */
export function withExperiencePage<Args extends unknown[]>(Page: (...args: Args) => ReactNode | void | Promise<ReactNode | void>, options: { admin?: boolean } = {}) {
  return async function ExperiencePage(...args: Args) {
    await connection();
    // Compatibility redirect pages may return void; React treats it as empty.
    const content = await Page(...args) as ReactNode;
    return <ExperiencePageBoundary admin={options.admin} renderRevision={crypto.randomUUID()}>{content}</ExperiencePageBoundary>;
  };
}
