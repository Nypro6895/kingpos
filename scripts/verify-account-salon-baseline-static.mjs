import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const baselinePath = "supabase/migrations/202607240001_account_salon_baseline.sql";
const baseline = readFileSync(join(root, baselinePath), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const path = join(dir, entry);
    const fullPath = join(root, path);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry !== "node_modules" && entry !== ".next") {
        walk(path, files);
      }
      continue;
    }

    if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

function uniqueMatches(text, regex) {
  return [...new Set([...text.matchAll(regex)].map((match) => match[1]))].sort();
}

assert(
  !/\busing\s*\(\s*true\s*\)/i.test(baseline),
  "Baseline still contains USING(true).",
);
assert(
  !/\bwith\s+check\s*\(\s*true\s*\)/i.test(baseline),
  "Baseline still contains WITH CHECK(true).",
);
assert(
  !/grant\s+select\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+(anon|authenticated)/i.test(
    baseline,
  ),
  "Baseline grants SELECT on all public tables to anon/authenticated.",
);
assert(
  !/grant\s+insert,\s*update,\s*delete\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+authenticated/i.test(
    baseline,
  ),
  "Baseline grants write on all public tables to authenticated.",
);
assert(
  !/grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+public\s+to\s+(anon|authenticated)/i.test(
    baseline,
  ),
  "Baseline grants EXECUTE on all public functions to anon/authenticated.",
);

const tables = uniqueMatches(baseline, /create\s+table\s+public\.([a-zA-Z0-9_]+)/gi);
const rlsTables = uniqueMatches(
  baseline,
  /alter\s+table\s+public\.([a-zA-Z0-9_]+)\s+enable\s+row\s+level\s+security/gi,
);
const missingRls = tables.filter((table) => !rlsTables.includes(table));
assert(missingRls.length === 0, `Tables without RLS: ${missingRls.join(", ")}`);

for (const required of [
  "booking_customer_account_claims",
  "salon_profile_entitlement_definitions",
  "salon_profile_entitlement_overrides",
  "salon_profile_plan_catalog",
  "salon_profile_plan_entitlements",
  "salon_profile_subscriptions",
  "salon_profile_usage_events",
]) {
  assert(tables.includes(required), `Missing restored table: ${required}`);
}

for (const required of [
  "create extension if not exists pgcrypto",
  "create extension if not exists pg_trgm",
  "'salon-profile-media'",
  "'payroll-paystubs'",
  "public_read_active_salon_profile_media_objects",
  "payroll_users_read_paystub_objects",
  "on conflict (account_id, create_request_key)",
  "where create_request_key is not null",
]) {
  assert(baseline.includes(required), `Missing baseline contract text: ${required}`);
}

for (const requiredWriteGrant of [
  "salon_profile_looks",
  "salon_profile_updates",
]) {
  assert(
    new RegExp(
      `grant\\s+insert,\\s*update,\\s*delete\\s+on\\s+table[\\s\\S]*public\\.${requiredWriteGrant}[\\s\\S]*to\\s+authenticated`,
      "i",
    ).test(baseline),
    `Missing authenticated write grant for ${requiredWriteGrant}.`,
  );
}

const sourceFiles = [...walk("app"), ...walk("lib")];
const appSource = sourceFiles
  .map((file) => readFileSync(join(root, file), "utf8"))
  .join("\n");
const fromNames = uniqueMatches(appSource, /\.from\(\s*["']([a-zA-Z0-9_]+)["']\s*\)/g);
const functionNames = uniqueMatches(
  baseline,
  /create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)/gi,
);
const rpcNames = uniqueMatches(appSource, /\.rpc\(\s*["']([a-zA-Z0-9_]+)["']/g);
const missingTables = fromNames.filter((table) => !tables.includes(table));
const missingRpcs = rpcNames.filter((rpc) => !functionNames.includes(rpc));

assert(missingTables.length === 0, `App references missing tables: ${missingTables.join(", ")}`);
assert(missingRpcs.length === 0, `App references missing RPCs: ${missingRpcs.join(", ")}`);

const activeSource = [
  ...sourceFiles,
  ...walk("types"),
  ...walk("scripts").filter(
    (file) => file !== "scripts\\verify-account-salon-baseline-static.mjs"
      && file !== "scripts/verify-account-salon-baseline-static.mjs",
  ),
  baselinePath,
]
  .map((file) => readFileSync(join(root, file), "utf8"))
  .join("\n");
assert(
  !/organization|organization_id|organizations|organization_memberships|business_memberships|business_id|BusinessMembership|currentOrganization|activeOrganization|organizationContext/i.test(
    activeSource,
  ),
  "Active source still contains legacy Organization references.",
);

console.log("Account-Salon baseline static verification passed.");
