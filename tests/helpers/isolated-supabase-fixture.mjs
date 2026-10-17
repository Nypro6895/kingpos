import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Opt-in integration fixture. Cached images only, no network/host ports/bind
// mounts, no persistent credentials, and no application notification worker.
export async function startIsolatedSupabase(labelPrefix = 'booking-access', options = {}) {
  const docker = process.env.TEST_DOCKER_PATH || (process.platform === 'win32'
    ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker');
  const context = process.env.TEST_DOCKER_CONTEXT || (process.platform === 'win32' ? 'desktop-linux' : 'default');
  const outputDir = process.env.BOOKING_TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'booking-tests-'));
  fs.mkdirSync(outputDir, { recursive: true });
  const label = crypto.randomUUID(), tag = `${labelPrefix}-${Date.now().toString(36)}`;
  const names = Object.fromEntries(['db', 'auth', 'storage', 'rest'].map(k => [k, `${tag}-${k}`]));
  const password = crypto.randomBytes(24).toString('hex'), jwtSecret = crypto.randomBytes(48).toString('hex');
  const redactions = [password, jwtSecret], created = [];
  const redact = value => redactions.reduce((text, secret) => text.replaceAll(secret, '[fixture-redacted]'), String(value));
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const evidence = { startedAt: new Date().toISOString(), label, containers: names, network: 'none',
    hostPortsPublished: false, persistentCredentials: false, migrationHashes: [] };
  function command(args, input, timeout = 30000, env = {}) {
    const r = cp.spawnSync(docker, ['--context', context, ...args], { input, encoding: 'utf8',
      windowsHide: true, timeout, maxBuffer: 30 * 1024 * 1024, env: { ...process.env, ...env } });
    if (r.status !== 0) throw Error(redact(r.stderr || r.error?.message || 'Docker command failed').slice(0, 2000));
    return (args[0] === 'logs' ? r.stdout + r.stderr : r.stdout).trim();
  }
  const sql = text => command(['exec', '-i', names.db, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-At'], text);
  const json = text => JSON.parse(sql(text));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function ready(check, message) {
    for (let i = 0; i < 35; i++) { try { if (check()) return; } catch {} await delay(1000); }
    throw Error(message);
  }
  function spawn(kind, image, env, extra = [], entry = []) {
    command(['run', '-d', '--pull=never', '--name', names[kind], '--label', `com.codex.task=${label}`,
      '--network', kind === 'db' ? 'none' : `container:${names.db}`,
      ...Object.keys(env).flatMap(k => ['-e', k]), ...extra, image, ...entry], undefined, 30000, env);
    created.push(kind);
  }
  function jwt(role) {
    const a = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(JSON.stringify({ role, iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const token = `${a}.${b}.${crypto.createHmac('sha256', jwtSecret).update(`${a}.${b}`).digest('base64url')}`;
    redactions.push(token); return token;
  }
  function http(port, url, method = 'GET', body, token, headers = []) {
    const quote = value => JSON.stringify(String(value));
    const config = [`url = ${quote(`http://127.0.0.1:${port}${url}`)}`, `request = ${quote(method)}`,
      'silent', 'show-error', 'include', 'max-time = 20', 'header = "Content-Type: application/json"',
      ...headers.map(h => `header = ${quote(h)}`), token ? `header = ${quote(`Authorization: Bearer ${token}`)}` : '',
      body === undefined ? '' : `data = ${quote(JSON.stringify(body))}`].filter(Boolean).join('\n');
    const raw = command(['exec', '-i', names.db, 'curl', '--config', '-'], config);
    const separator = raw.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n', index = raw.indexOf(separator);
    const head = raw.slice(0, index), text = raw.slice(index + separator.length);
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]), data };
  }
  function request(port, url, method, body, token) {
    const r = http(port, url, method, body, token, ['Prefer: return=representation']);
    if (r.status < 200 || r.status >= 300) throw Error(redact(`${url}: HTTP ${r.status}: ${r.data?.code || ''} ${r.data?.message || r.data?.msg || r.data?.error_description || ''}`));
    return r.data;
  }
  const rest = (person, url, method = 'GET', body) => request(3000, url, method, body, person?.token);
  const rpc = (person, name, args = {}) => rest(person, `/rpc/${name}`, 'POST', args);
  function person(kind) {
    const secret = `Fixture!${crypto.randomBytes(18).toString('hex')}`;
    redactions.push(secret);
    const email = `${kind}.${crypto.randomUUID().slice(0, 8)}@example.invalid`;
    const signed = request(9999, '/signup', 'POST', { email, password: secret, data: { display_name: `Fixture ${kind}`, first_name: 'Fixture', last_name: kind } });
    assert.ok(signed.user?.id);
    const login = request(9999, '/token?grant_type=password', 'POST', { email, password: secret });
    assert.ok(login.access_token); redactions.push(login.access_token);
    const user = { kind, email, token: login.access_token, authId: signed.user.id };
    const profiles = rest(user, `/users?auth_user_id=eq.${user.authId}&select=id`);
    user.profileId = profiles[0]?.id || rest(user, '/users', 'POST', { auth_user_id: user.authId,
      email, display_name: `Fixture ${kind}`, first_name: 'Fixture', last_name: kind, status: 'active' })[0].id;
    return user;
  }
  function save(name, data) { fs.writeFileSync(path.join(outputDir, name), JSON.stringify(data, null, 2)); }
  function close() {
    const removed = [];
    for (const kind of [...created].reverse()) {
      const meta = JSON.parse(command(['inspect', names[kind], '--format', '{"label":{{json (index .Config.Labels "com.codex.task")}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}']));
      assert.equal(meta.label, label); assert.equal(Object.keys(meta.ports || {}).length, 0);
      assert.ok(meta.mounts.every(m => m.Type === 'tmpfs'));
      if (kind === 'db') assert.equal(meta.network, 'none'); else assert.ok(meta.network.startsWith('container:'));
      command(['rm', '-f', names[kind]]); removed.push(names[kind]);
    }
    created.length = 0;
    const remaining = command(['ps', '-a', '--format', '{{.Names}}']).split('\n').filter(Boolean);
    evidence.cleanup = { removedOwnedContainers: removed, priorContainersPresent: evidence.priorContainers.every(n => remaining.includes(n)),
      testContainersRemaining: Object.values(names).filter(n => remaining.includes(n)), credentialsDiscarded: true };
    evidence.finishedAt = new Date().toISOString(); save(`${labelPrefix}-fixture.json`, evidence);
    assert.ok(evidence.cleanup.priorContainersPresent); assert.equal(evidence.cleanup.testContainersRemaining.length, 0);
  }
  evidence.priorContainers = command(['ps', '-a', '--format', '{{.Names}}']).split('\n').filter(Boolean);
  try {
    spawn('db', 'public.ecr.aws/supabase/postgres:17.6.1.127', { POSTGRES_PASSWORD: password, POSTGRES_DB: 'postgres', POSTGRES_USER: 'supabase_admin', PGDATA: '/var/lib/postgresql/data' },
      ['--tmpfs', '/var/lib/postgresql/data:rw,size=1073741824'], ['postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=127.0.0.1', '-c', 'cron.launch_active_jobs=off']);
    // The image first starts a temporary Unix-socket-only initialization server.
    // Wait for the final TCP listener before changing roles or starting Auth.
    await ready(() => command(['exec', names.db, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'supabase_admin', '-d', 'postgres']).includes('accepting connections') && sql('select 1') === '1', 'Fixture database unavailable');
    sql(`alter role supabase_auth_admin with password '${password}';alter role supabase_storage_admin with password '${password}';alter role authenticator with password '${password}';`);
    spawn('auth', 'public.ecr.aws/supabase/gotrue:v2.193.1', { GOTRUE_API_HOST: '127.0.0.1', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://127.0.0.1:9999',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@127.0.0.1:5432/postgres`, GOTRUE_SITE_URL: 'http://fixture.invalid',
      GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_RATE_LIMIT_EMAIL_SENT: '100', GOTRUE_LOG_LEVEL: 'error' });
    await ready(() => http(9999, '/health').status === 200, 'Fixture Auth unavailable');
    spawn('storage', 'public.ecr.aws/supabase/storage-api:v1.67.8', { ANON_KEY: jwt('anon'), SERVICE_KEY: jwt('service_role'), PGRST_JWT_SECRET: jwtSecret,
      POSTGREST_URL: 'http://127.0.0.1:3000', DATABASE_URL: `postgres://supabase_storage_admin:${password}@127.0.0.1:5432/postgres`, STORAGE_BACKEND: 'file',
      FILE_STORAGE_BACKEND_PATH: '/var/lib/storage', TENANT_ID: 'isolated-booking-tests', REGION: 'local', GLOBAL_S3_BUCKET: 'local', FILE_SIZE_LIMIT: '1048576',
      ENABLE_IMAGE_TRANSFORMATION: 'false', PORT: '5000', HOST: '127.0.0.1' }, ['--tmpfs', '/var/lib/storage:rw,size=16777216']);
    await ready(() => sql("select to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null") === 't', 'Fixture Storage schema unavailable');
    const migrations = path.join(process.cwd(), 'supabase/migrations');
    for (const file of fs.readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
      const bytes = fs.readFileSync(path.join(migrations, file));
      options.beforeMigration?.({ file, sql, json });
      // Git's Windows checkout can use CRLF, while existing migrations patch
      // pg_get_functiondef using LF literals. Match production SQL line ends
      // without rewriting any source; retain both input hashes as evidence.
      const source = bytes.toString().replaceAll('\r\n', '\n');
      sql(`begin;\n${source}\ncommit;`); evidence.migrationHashes.push({ file, sha256: hash(bytes), executedSha256: hash(source) });
      if (evidence.migrationHashes.length % 50 === 0) console.log(`Isolated fixture: ${evidence.migrationHashes.length} migrations`);
    }
    spawn('rest', 'public.ecr.aws/supabase/postgrest:v14.5', { PGRST_DB_URI: `postgres://authenticator:${password}@127.0.0.1:5432/postgres`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: jwtSecret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '3000', PGRST_LOG_LEVEL: 'error' });
    await ready(() => http(3000, '/').status === 200, 'Fixture PostgREST unavailable');
    return { sql, json, http, request, rest, rpc, person, save, close, evidence, redact };
  } catch (error) { evidence.error = redact(error.message); evidence.bootstrapLogs = {}; for (const kind of created) { try { evidence.bootstrapLogs[kind] = redact(command(['logs', '--tail', '15', names[kind]])).slice(-4000); } catch (logError) { evidence.bootstrapLogs[kind] = redact(logError.message); } } close(); throw error; }
}
