// Keep newly published items visible until server data includes them.
// Once present on the server, prefer its current counters and edited content.
export function mergePublishedItems<T extends { id: string }>(published: T[], serverItems: T[]): T[] {
  const serverIds = new Set(serverItems.map((item) => item.id));
  return [...published.filter((item) => !serverIds.has(item.id)), ...serverItems];
}
