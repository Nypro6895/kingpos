/** A bounded transport codec. Command arguments are never read-model snapshots. */
export type AppLocalEncoded = null | boolean | number | string | AppLocalEncoded[] | { [key: string]: AppLocalEncoded };
const tag = "$reylumi";
const fail = (): never => { throw new Error("This form could not be sent. Please open it again."); };
function plain(value: object) { return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null; }
export async function encodeAppLocalValue(value: unknown, depth = 0): Promise<AppLocalEncoded> {
  if (depth > 16) fail();
  if (value === undefined) return { [tag]: "undefined" };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail();
  if (value instanceof FormData) {
    const entries: AppLocalEncoded[] = [];
    for (const [key, item] of value) entries.push([key, await encodeAppLocalValue(item, depth + 1)]);
    return { [tag]: "form", entries };
  }
  if (value instanceof Blob) {
    if (value.size > 4 * 1024 * 1024) throw new Error("Open the online page to attach a larger file.");
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = ""; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { [tag]: "file", name: typeof File !== "undefined" && value instanceof File ? value.name : "attachment", type: value.type, data: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => encodeAppLocalValue(item, depth + 1)));
  if (value && typeof value === "object" && plain(value) && !(tag in value)) {
    const result: Record<string, AppLocalEncoded> = Object.create(null);
    for (const [key, item] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) fail(); result[key] = await encodeAppLocalValue(item, depth + 1); }
    return result;
  }
  return fail();
}
export function decodeAppLocalValue(value: unknown, depth = 0): unknown {
  if (depth > 16) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail();
  if (Array.isArray(value)) return value.map(item => decodeAppLocalValue(item, depth + 1));
  if (!value || typeof value !== "object" || !plain(value)) fail();
  const record = value as Record<string, unknown>;
  if (record[tag] === "undefined" && Object.keys(record).length === 1) return undefined;
  if (record[tag] === "file") {
    if (Object.keys(record).length !== 4 || typeof record.name !== "string" || record.name.length > 255 || typeof record.type !== "string" || record.type.length > 255 || typeof record.data !== "string" || record.data.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.data)) fail();
    const binary = atob(record.data as string); if (binary.length > 4 * 1024 * 1024) fail();
    return new File([Uint8Array.from(binary, char => char.charCodeAt(0))], record.name as string, { type: record.type as string });
  }
  if (record[tag] === "form") {
    if (Object.keys(record).length !== 2 || !Array.isArray(record.entries) || record.entries.length > 512) fail();
    const form = new FormData();
    for (const entry of record.entries as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || entry[0].length > 512) fail();
      const pair = entry as [string, unknown];
      const item = decodeAppLocalValue(pair[1], depth + 1); if (typeof item !== "string" && !(item instanceof Blob)) fail();
      form.append(pair[0], item as string | Blob);
    }
    return form;
  }
  if (tag in record) fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(record)) { if (["__proto__", "constructor", "prototype"].includes(key)) fail(); result[key] = decodeAppLocalValue(item, depth + 1); }
  return result;
}
