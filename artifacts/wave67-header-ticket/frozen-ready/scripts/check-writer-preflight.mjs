import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Explicit, read-only staging checks. No env-file execution, mutations, secret
// values, auth tokens, financial rows, provider calls or sales enablement.
export function checkConfig(env, expectedRef) {
  const issues = [];
  let url;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {}
  if (!/^[a-z0-9]{20}$/.test(expectedRef ?? ""))
    issues.push("Supply the exact staging project ref.");
  if (
    !url ||
    url.protocol !== "https:" ||
    url.hostname !== `${expectedRef}.supabase.co` ||
    url.username ||
    url.password ||
    url.port
  )
    issues.push(
      "Supabase URL does not match the explicitly selected staging project.",
    );
  if (env.CHECK_WRITER_ENVIRONMENT !== "staging")
    issues.push(
      "CHECK_WRITER_ENVIRONMENT must be staging in this private verification config.",
    );
  if (env.CHECK_WRITER_SALES_ENABLED === "true")
    issues.push("Keep CHECK_WRITER_SALES_ENABLED false during preparation.");
  const active = env.CHECK_WRITER_ACTIVE_KEY_ID || "v1";
  let keys = {};
  try {
    keys = env.CHECK_WRITER_ENCRYPTION_KEYS
      ? JSON.parse(env.CHECK_WRITER_ENCRYPTION_KEYS)
      : {};
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw Error();
  } catch {
    issues.push("Invalid encryption key map.");
    keys = {};
  }
  const key =
    keys[active] ||
    (active === "v1" ? env.CHECK_WRITER_ENCRYPTION_KEY : undefined);
  if (
    !/^[a-zA-Z0-9_-]{1,32}$/.test(active) ||
    typeof key !== "string" ||
    !/^[a-f0-9]{64}$/i.test(key)
  )
    issues.push("A valid server-only active encryption key is required.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    issues.push("Missing staging service role credential.");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    issues.push("Missing staging anonymous credential.");
  return issues;
}
function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) {
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      env[m[1]] = value;
    }
  }
  return env;
}
async function main() {
  const args = process.argv.slice(2),
    get = (name) => args[args.indexOf(name) + 1];
  if (!args.includes("--env-file") || !args.includes("--staging-project-ref"))
    throw Error(
      "Usage: node scripts/check-writer-preflight.mjs --env-file <private staging file> --staging-project-ref <ref> [--check-backend]",
    );
  const env = readEnv(get("--env-file"));
  const issues = checkConfig(env, get("--staging-project-ref"));
  if (issues.length) {
    console.log(JSON.stringify({ passed: false, issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const checks = [
    { name: "Private staging config and closed sales", passed: true },
  ];
  if (args.includes("--check-backend")) {
    const base = new URL("/rest/v1/", env.NEXT_PUBLIC_SUPABASE_URL);
    const read = async (path, key) =>
      fetch(new URL(path, base), {
        headers: { apikey: key, Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(15000),
      });
    for (const table of [
      "check_writer_settings",
      "check_writer_subscriptions",
      "check_writer_checks",
      "check_writer_batches",
      "check_writer_events",
      "check_writer_outputs",
      "check_writer_creation_requests",
    ]) {
      const query = table + "?select=salon_id&limit=0";
      const service = await read(query, env.SUPABASE_SERVICE_ROLE_KEY);
      checks.push({
        name: table + " service schema access",
        passed: service.ok,
      });
      const anon = await read(query, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      checks.push({
        name: table + " denies anonymous table access",
        passed: [401, 403].includes(anon.status),
      });
    }
    const catalog = await read(
      "market_billing_catalog?select=price_cents,fulfillment_ready&plugin_id=eq.print-check",
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const row = catalog.ok ? (await catalog.json())[0] : null;
    checks.push({
      name: "Catalog USD 4.90 and paid sales closed",
      passed: row?.price_cents === 490 && row?.fulfillment_ready === false,
    });
  }
  const passed = checks.every((c) => c.passed);
  console.log(
    JSON.stringify(
      {
        passed,
        checks,
        scope:
          "Read-only staging preflight; not provider/native/physical acceptance",
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Staging verification failed. Check private configuration, connectivity and migration state; no secret values logged.",
    );
    process.exitCode = 1;
  });
