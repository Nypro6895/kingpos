const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const https = value => {
  const u = new URL(value);
  if (u.origin !== value || u.protocol !== "https:" || u.username || u.password || u.port) throw Error("Invalid reviewed QA origin");
  return u;
};
export function readHostedConfig(env, target) {
  if (!target || target.approved !== true || env.QR_MENU_QA_ONLY !== "true") throw Error("Reviewed QA target configuration is required");
  const market = https(target.marketOrigin), qr = https(target.qrOrigin), auth = https(target.supabaseOrigin);
  if (!market.hostname.endsWith(".vercel.app") || !qr.hostname.endsWith(".vercel.app") || market.origin === qr.origin ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(auth.hostname) || !uuid.test(target.appClientId) || !Array.isArray(target.allowedAuthUsers) || !target.allowedAuthUsers.length || target.allowedAuthUsers.length>10 || !target.allowedAuthUsers.every(x=>uuid.test(x)) ||
    !/^[a-z0-9.-]+$/.test(target.postgresHost ?? "") || ![5432,6543].includes(target.postgresPort) ||
    !/^qr_menu_qa_runtime(?:\.[a-z0-9]{20})?$/.test(target.postgresUser ?? "")) throw Error("Invalid reviewed QA target");
  const ref=auth.hostname.split('.')[0];
  if (target.postgresHost === 'db.'+ref+'.supabase.co' ? target.postgresUser !== 'qr_menu_qa_runtime' : !target.postgresHost.endsWith('.pooler.supabase.com') || target.postgresUser !== 'qr_menu_qa_runtime.'+ref) throw Error('QA database must belong to the reviewed Auth project');
  if (new Set(target.allowedAuthUsers).size!==target.allowedAuthUsers.length) throw Error('Duplicate QA identities');
  if (env.REYLUMI_MARKET_API_ORIGIN !== target.marketOrigin || env.QR_MENU_PUBLIC_ORIGIN !== target.qrOrigin || env.QR_MENU_AUTH_ORIGIN !== target.supabaseOrigin ||
    env.REYLUMI_MARKET_CLIENT_ID !== target.appClientId || !/^rmc_[A-Za-z0-9_-]{43}$/.test(env.REYLUMI_MARKET_CLIENT_SECRET ?? "") || env.QR_MENU_SANDBOX_TOKEN)
    throw Error("QA runtime does not match the reviewed target");
  const database = new URL(env.QR_MENU_DATABASE_URL ?? "");
  if (!["postgres:","postgresql:"].includes(database.protocol) || database.hostname !== target.postgresHost || Number(database.port || 5432) !== target.postgresPort ||
    decodeURIComponent(database.username) !== target.postgresUser || !database.password || database.pathname !== "/postgres" || database.search || database.hash)
    throw Error("QA database configuration does not match the restricted reviewed role/host");
  const decodeKey = value => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error("Missing server-only QA encryption key");
    const bytes = Buffer.from(value,"base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== value) throw Error("Invalid QA encryption key");
    return bytes;
  };
  const grantKey = decodeKey(env.QR_MENU_GRANT_KEY), sessionKey = decodeKey(env.QR_MENU_SESSION_KEY);
  if (grantKey.equals(sessionKey)) throw Error("Grant and app session keys must be separate");
  const keyId = env.QR_MENU_GRANT_KEY_ID;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId ?? "") || !/^(?:eyJ[A-Za-z0-9_.-]{40,4096}|sb_publishable_[A-Za-z0-9_-]{16,256})$/.test(env.QR_MENU_AUTH_ANON_KEY ?? "")) throw Error("Missing QA public Auth configuration");
  const grantKeys = { [keyId]: grantKey };
  if (env.QR_MENU_PREVIOUS_GRANT_KEY_ID || env.QR_MENU_PREVIOUS_GRANT_KEY) {
    const previousId=env.QR_MENU_PREVIOUS_GRANT_KEY_ID;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(previousId??'') || previousId===keyId) throw Error('Invalid previous QA key ID');
    const previous=decodeKey(env.QR_MENU_PREVIOUS_GRANT_KEY);
    if (previous.equals(sessionKey)) throw Error('Grant and app session keys must be separate');
    grantKeys[previousId]=previous;
  }
  const anon=env.QR_MENU_AUTH_ANON_KEY;
  if (anon?.startsWith('eyJ')) { let claims;try{claims=JSON.parse(Buffer.from(anon.split('.')[1],'base64url').toString());}catch{throw Error('Invalid public Auth key');}if(claims.role!=='anon')throw Error('Only the public anon key is accepted'); }
  // No connectionString: pg must not parse URL ssl options and override TLS.
  return {
    api: target.marketOrigin, publicOrigin: target.qrOrigin, authOrigin: target.supabaseOrigin,
    clientId: target.appClientId, clientSecret: env.REYLUMI_MARKET_CLIENT_SECRET, grantKeys,
    allowedUsers: [...target.allowedAuthUsers], anonKey: env.QR_MENU_AUTH_ANON_KEY, grantKey, sessionKey, keyId,
    pool: { host: target.postgresHost, port: target.postgresPort, user: target.postgresUser, password: decodeURIComponent(database.password), database: "postgres",
      max: 1, min: 0, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, query_timeout: 4000, statement_timeout: 4000, lock_timeout: 1000,
      ssl: { rejectUnauthorized: true }, allowExitOnIdle: true, application_name: "reylumi-qr-menu-qa" },
  };
}
