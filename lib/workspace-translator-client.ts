"use client";

export type WorkspaceTranslator = typeof import("./vietnamese-dictionary").translateVietnamese;

let loaded: WorkspaceTranslator | null = null;
let pending: Promise<WorkspaceTranslator> | null = null;

export function getLoadedWorkspaceTranslator() { return loaded; }

/** UI copy is shared safely; each provider still owns its language eligibility. */
export function loadWorkspaceTranslator(): Promise<WorkspaceTranslator> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  const request = import("./vietnamese-dictionary").then(module => {
    loaded = module.translateVietnamese;
    return loaded;
  }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}
