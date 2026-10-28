/** Presentation identity only. The host appends the authenticated scope and
 * generation, so sharing query navigation never shares account authority. */
export function appLocalPageKey(path: string, id?: string): string {
  return id && (["explore", "market", "portable", "settings.hub"].includes(id) || id.startsWith("business.regular:")) ? "family:" + id : path;
}

/** The latest URL wins even when it was already visited. Retaining an older
 * detail query can reopen its portal when that page becomes inactive. */
export function rememberAppLocalPaths(paths: string[], incoming: string[], key: (path: string) => string): string[] {
  const latest = new Map<string, string>();
  for (const path of [...paths, ...incoming]) {
    const identity = key(path);
    latest.delete(identity);
    latest.set(identity, path);
  }
  return [...latest.values()].slice(-16);
}
