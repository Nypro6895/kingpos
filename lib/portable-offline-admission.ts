"use client";

type Admission = Readonly<{ active: boolean; revision: number }>;
const emptyAdmission: Admission = { active: false, revision: 0 };
const registrations = new Set<symbol>();
const listeners = new Set<() => void>();
let snapshot = emptyAdmission;

function publish() {
  // A revision also invalidates work when one POS replaces another in the same
  // commit, while the root guest identity and URL both remain unchanged.
  snapshot = { active: registrations.size > 0, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}

/** Optional preparation belongs to a mounted, server-authorized POS boundary. */
export function registerPortableOfflineAdmission(): () => void {
  const token = Symbol("portable-offline-admission");
  registrations.add(token);
  publish();
  return () => {
    if (registrations.delete(token)) publish();
  };
}

export function subscribePortableOfflineAdmission(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getPortableOfflineAdmission(): Admission { return snapshot; }
export function getServerPortableOfflineAdmission(): Admission { return emptyAdmission; }
