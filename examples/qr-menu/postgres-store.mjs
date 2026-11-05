import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { retryAttemptIsLive } from "./refresh-attempt.mjs";
const stores = new WeakSet();
const bindingHash = (binding) => createHash("sha256").update(JSON.stringify([binding.api, binding.clientId, binding.publicOrigin])).digest("hex");
export const isPostgresStore = (store, binding) => stores.has(store) && store.contextId === bindingHash(binding);
const unavailable = () => new Error("QR durable state unavailable; reconnect from Market if required.");

// A deliberately conservative reference: one fenced lease per app/origin.
// Credential/session writes are serialized, with bounded contention (503).
// Public reads decrypt a committed snapshot without a lease or a state rewrite;
// every data/image request still checks the authoritative Market API.
// A host may further shard writes by installation only after preserving
// callback/refresh fencing. The encrypted snapshot remains bounded to 4 MiB.
export function createPostgresStore({ query, keys, activeKeyId, binding }) {
  if (typeof query !== "function" || !binding || !binding.api || !binding.clientId || !binding.publicOrigin ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(activeKeyId ?? "") || !keys ||
      !Object.values(keys).every(k => Buffer.isBuffer(k) && k.length === 32) || !keys[activeKeyId])
    throw new Error("Inject PostgreSQL query, exact binding and a server-only 32-byte encryption key ring.");
  const keyRing = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, Buffer.from(key)]));
  const contextId = bindingHash(binding);
  const aad = revision => Buffer.from(contextId + ":" + revision);
  function seal(state, revision) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyRing[activeKeyId], iv);
    cipher.setAAD(aad(revision));
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw unavailable();
    const bytes = Buffer.concat([cipher.update(serialized), cipher.final()]);
    return { keyId: activeKeyId, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: bytes.toString("base64url") };
  }
  function open(envelope, revision) {
    if (envelope === null && String(revision) === "0") return { sessions: [], menus: [], byInstallation: [] };
    try {
      const key = keyRing[envelope.keyId];
      if (!key) throw unavailable();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAAD(aad(revision));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64url")), decipher.final()]).toString());
      if (![state.sessions, state.menus, state.byInstallation].every(Array.isArray)) throw unavailable();
      return state;
    } catch { throw unavailable(); }
  }
  const store = {
    contextId,
    async read(work) {
      const result=await query("SELECT revision,envelope,lease_owner,lease_until,clock_timestamp() AS db_now FROM qr_menu_private.qr_menu_state WHERE context_id=$1",[contextId]);
      if(result.rows.length!==1) return work({sessions:[],menus:[],byInstallation:[]},async()=>{},Date.now,true);
      const row=result.rows[0],state=open(row.envelope,String(row.revision));
      const instant=row.db_now,dbNow=instant instanceof Date?instant.getTime():Date.parse(instant),started=performance.now();
      if(!Number.isFinite(dbNow))throw unavailable();
      return work(state,async()=>{},()=>dbNow+performance.now()-started,true,Boolean(row.lease_owner && Date.parse(row.lease_until)>dbNow));
    },
    async run(work) {
      const owner = randomUUID();
      await query("INSERT INTO qr_menu_private.qr_menu_state(context_id) VALUES ($1) ON CONFLICT DO NOTHING", [contextId]);
      const claimed = await query(`UPDATE qr_menu_private.qr_menu_state SET lease_owner=$2, lease_until=clock_timestamp()+interval '60 seconds'
        WHERE context_id=$1 AND (lease_owner IS NULL OR lease_until < clock_timestamp()) RETURNING revision,envelope,clock_timestamp() AS db_now`, [contextId, owner]);
      if (claimed.rows.length !== 1) throw unavailable();
      let revision = String(claimed.rows[0].revision);
      try {
        const state = open(claimed.rows[0].envelope, revision);
        const instant = claimed.rows[0].db_now;
        const dbNow = instant instanceof Date ? instant.getTime() : Date.parse(instant), started = performance.now();
        if (!Number.isFinite(dbNow)) throw unavailable();
        const now = () => dbNow + performance.now() - started;
        // A crash/ambiguous refresh must never replay a possibly consumed refresh token.
        for (const [, record] of state.menus) {
          if (record.refreshUncertain && !retryAttemptIsLive(record,now())) { record.grant = null; record.reconnectRequired = true; delete record.refreshUncertain;delete record.refreshAttempt; }
        }
        const checkpoint = async () => {
          const next = String(BigInt(revision) + 1n), envelope = seal(state, next);
          const result = await query(`UPDATE qr_menu_private.qr_menu_state SET revision=revision+1,envelope=$4::jsonb
            WHERE context_id=$1 AND lease_owner=$2 AND revision=$3::bigint AND lease_until > clock_timestamp() RETURNING revision`,
            [contextId, owner, revision, JSON.stringify(envelope)]);
          if (result.rows.length !== 1) throw unavailable();
          revision = String(result.rows[0].revision);
        };
        const result = await work(state, checkpoint, now);
        await checkpoint(); // The HTTP adapter must flush only after this fenced commit.
        return result;
      } catch { throw unavailable(); }
      finally {
        // Never release another worker's lease; expiration is recovery, not permission to replay.
        await query("UPDATE qr_menu_private.qr_menu_state SET lease_owner=NULL,lease_until=NULL WHERE context_id=$1 AND lease_owner=$2", [contextId, owner]);
      }
    },
  };
  stores.add(store);
  return Object.freeze(store);
}
