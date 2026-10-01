// An unresolved send keeps its ID across retries and reloads. The database
// primary key makes repeating that send an insert-or-read, never a second row.
const pending = new Map<string, string>();
type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function prepareCommentRequest(
  scope: string,
  payload: { body: string; parentCommentId: string | null; asSalonReply: boolean },
  storage: RequestStorage | null,
  uuid: () => string,
) {
  const key = `reylumi:comment-send:v1:${scope}:${JSON.stringify(payload)}`;
  let id = pending.get(key);
  try { id ??= storage?.getItem(key) ?? undefined; } catch { /* Optional storage. */ }
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) id = uuid();
  pending.set(key, id);
  try { storage?.setItem(key, id); } catch { /* In-memory retries still reuse the ID. */ }
  return { key, id };
}

export function completeCommentRequest(key: string, storage: RequestStorage | null) {
  pending.delete(key);
  try { storage?.removeItem(key); } catch { /* Keeping a resolved ID is safe. */ }
}
