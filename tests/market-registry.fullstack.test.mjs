import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Explicit opt-in only. The existing helper uses cached images (--pull=never),
// a network-none namespace shared by the fixture containers, tmpfs data and no
// published host ports. It creates synthetic identities through local GoTrue;
// no project URL, real account, application credential or external API is used.
const enabled = process.env.RUN_MARKET_REGISTRY_FULLSTACK === "1";
const uuid = value => {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return `'${value}'::uuid`;
};
const manifest = (overrides = {}) => ({ manifestSchemaVersion: 1, appVersion: "1.0.0",
  displayName: "  Cafe\u0301 fixture  ", description: "Synthetic registry metadata only.",
  requestedCapabilities: [], ...overrides });

function assertDenied(response, label) {
  assert.ok([401, 403].includes(response.status), `${label}: expected access denial, received HTTP ${response.status}`);
  assert.equal(response.data?.code, "42501", `${label}: expected a database permission denial`);
}

function assertConflict(response, label) {
  // Deterministic domain conflicts must reach the caller immediately. Using
  // serialization_failure (40001) can trigger PostgREST transaction retries.
  assert.equal(response.status, 409, `${label}: expected HTTP Conflict`);
  assert.equal(response.data?.code, "PT409", `${label}: expected an optimistic-concurrency conflict`);
}

// Unlike the helper's synchronous rpc(), these are separate asynchronous docker
// exec processes and PostgreSQL connections. Curl config (including the ephemeral
// user token) travels on stdin, never in argv, logs or an evidence artifact.
function asyncDockerInput(fixture, args, input, readyMarker) {
  const docker = process.env.TEST_DOCKER_PATH || (process.platform === "win32"
    ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "docker");
  const context = process.env.TEST_DOCKER_CONTEXT || (process.platform === "win32" ? "desktop-linux" : "default");
  let resolveReady, rejectReady;
  const ready = readyMarker ? new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }) : Promise.resolve();
  const child = spawn(docker, ["--context", context, ...args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", readySeen = false, ended = false;
  const done = new Promise((resolve, reject) => {
    const fail = error => {
      if (ended) return;
      ended = true; clearTimeout(timer);
      const safe = new Error(fixture.redact(error.message).slice(0, 2000));
      rejectReady?.(safe); reject(safe);
    };
    const timer = setTimeout(() => { child.kill(); fail(new Error("Isolated Docker request exceeded 30 seconds.")); }, 30000);
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) { child.kill(); fail(new Error("Isolated request exceeded the output limit.")); }
      if (readyMarker && stdout.includes(readyMarker) && !readySeen) { readySeen = true; resolveReady(); }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.on("close", code => {
      if (ended) return;
      if (code !== 0) return fail(new Error(stderr || `Isolated Docker request failed (${code}).`));
      if (readyMarker && !readySeen) return fail(new Error("Fixture row lock was not acquired."));
      ended = true; clearTimeout(timer); resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
  // A failure can occur before the caller starts awaiting one of these promises.
  void done.catch(() => {}); void ready.catch(() => {});
  return { done, ready };
}

async function concurrentReview(fixture, person, params) {
  const quote = value => JSON.stringify(String(value));
  const config = [
    'url = "http://127.0.0.1:3000/rpc/market_registry_review"', 'request = "POST"',
    "silent", "show-error", "include", "max-time = 20", 'header = "Content-Type: application/json"',
    `header = ${quote(`Authorization: Bearer ${person.token}`)}`,
    `data = ${quote(JSON.stringify(params))}`,
  ].join("\n");
  const raw = await asyncDockerInput(fixture, ["exec", "-i", fixture.evidence.containers.db, "curl", "--config", "-"], config).done;
  const separator = raw.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const index = raw.indexOf(separator);
  assert.ok(index > 0, "Local PostgREST must return HTTP headers");
  const status = Number(raw.slice(0, index).match(/^HTTP\/\S+ (\d+)/)?.[1]);
  assert.ok(Number.isInteger(status) && status >= 100, "Local PostgREST must return an HTTP status");
  return { status, data: JSON.parse(raw.slice(index + separator.length)) };
}

test("private registry: all migrations, real GoTrue/PostgREST roles, review race and erasure", {
  skip: enabled ? false : "Set RUN_MARKET_REGISTRY_FULLSTACK=1 to opt into the disposable, cached-image, network-isolated Supabase fixture.",
  timeout: 10 * 60 * 1000,
}, async () => {
  const { startIsolatedSupabase } = await import("./helpers/isolated-supabase-fixture.mjs");
  const fixture = await startIsolatedSupabase("market-registry", { boundedResources: true, normalizeMigrationLineEndings: true });
  const evidence = { completed: false, checks: [], concurrency: null };
  const pending = [];
  const rpcHttp = (person, name, args = {}) => fixture.http(3000, `/rpc/${name}`, "POST", args, person?.token);
  try {
    const migrations = fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
    assert.ok(migrations.includes("20261022180001_market_private_registry.sql"));
    assert.equal(fixture.evidence.migrationLineEndings, "crlf-to-lf");
    assert.deepEqual(fixture.evidence.migrationHashes, migrations.map(file => {
      const bytes = fs.readFileSync(path.join(process.cwd(), "supabase/migrations", file));
      const source = bytes.toString().replace(/\r\n/g, "\n");
      return { file, sha256: createHash("sha256").update(bytes).digest("hex"),
        executedSha256: createHash("sha256").update(source).digest("hex"),
        executedScriptSha256: createHash("sha256").update(`begin;\n${source}\n;\ncommit;`).digest("hex"), normalization: "crlf-to-lf" };
    }));
    assert.equal(fixture.evidence.network, "none");
    assert.equal(fixture.evidence.hostPortsPublished, false);
    assert.equal(fixture.evidence.persistentCredentials, false);
    assert.deepEqual(fixture.evidence.resourceBounds, Object.fromEntries([
      ["db", 512], ["auth", 128], ["storage", 192], ["rest", 128],
    ].map(([kind, mib]) => [kind, { memory: mib * 1024 * 1024, memorySwap: mib * 1024 * 1024, nanoCpus: 1000000000 }])));
    assert.equal(fixture.sql("show cron.launch_active_jobs"), "off");
    evidence.migrationCount = migrations.length;
    evidence.checks.push("All raw migration hashes and LF-normalized executed-source hashes match the disposable database fixture.");

    const developer = fixture.person("registry-developer-a");
    const otherDeveloper = fixture.person("registry-developer-b");
    const reviewer = fixture.person("registry-reviewer-a");
    const secondReviewer = fixture.person("registry-reviewer-b");
    const outsider = fixture.person("registry-outsider");
    for (const person of [developer, otherDeveloper, reviewer, secondReviewer, outsider]) {
      assert.equal(fixture.sql(`select status from public.users where id=${uuid(person.profileId)}`), "active");
    }
    fixture.sql(`insert into market_private.publishers(owner_user_id,name) values
      (${uuid(developer.profileId)},'Synthetic publisher A'),(${uuid(otherDeveloper.profileId)},'Synthetic publisher B');
      insert into market_private.reviewers(user_id) values (${uuid(reviewer.profileId)}),(${uuid(secondReviewer.profileId)});`);

    assert.equal(fixture.sql("select enabled from market_private.settings where id"), "f");
    assertDenied(rpcHttp(developer, "market_registry_workspace"), "Gate defaults off for developers");
    assertDenied(rpcHttp(reviewer, "market_registry_review_queue"), "Gate defaults off for reviewers");
    assertDenied(rpcHttp(null, "market_registry_workspace"), "Anonymous execution");
    const permissionState = fixture.json(`select jsonb_build_object(
      'schemaRoles', (select jsonb_agg(jsonb_build_object('role',r,'usage',has_schema_privilege(r,'market_private','usage')))
        from unnest(array['anon','authenticated','service_role']) r),
      'tables', (select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
        'authenticatedSelect',has_table_privilege('authenticated',c.oid,'select'),
        'serviceSelect',has_table_privilege('service_role',c.oid,'select')))
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='market_private' and c.relkind='r'),
      'rpc', (select jsonb_agg(jsonb_build_object('name',p.proname,
        'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
        'anon',has_function_privilege('anon',p.oid,'execute'),
        'service',has_function_privilege('service_role',p.oid,'execute')))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'market_registry_%'))`);
    assert.equal(permissionState.tables.length, 7);
    assert.ok(permissionState.schemaRoles.every(row => row.usage === false));
    assert.ok(permissionState.tables.every(row => row.rls && !row.authenticatedSelect && !row.serviceSelect));
    assert.equal(permissionState.rpc.length, 6);
    assert.ok(permissionState.rpc.every(row => row.authenticated && !row.anon && !row.service));
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.throws(() => fixture.sql(`set role ${role};select id from market_private.apps`), /permission denied/i);
    }
    const privateSchema = fixture.http(3000, "/apps?select=id", "GET", undefined, developer.token, ["Accept-Profile: market_private"]);
    assert.equal(privateSchema.status, 406);
    assert.equal(privateSchema.data?.code, "PGRST106");
    evidence.checks.push("Default-off gate, anonymous/service-role grants, RLS and direct schema access are denied.");

    fixture.sql("update market_private.settings set enabled=true where id");
    assertDenied(rpcHttp(outsider, "market_registry_workspace"), "Unprovisioned developer");
    assertDenied(rpcHttp(outsider, "market_registry_review_queue"), "Unprovisioned reviewer");
    assertDenied(rpcHttp(reviewer, "market_registry_workspace"), "Reviewer is not a publisher");
    assertDenied(rpcHttp(developer, "market_registry_review_queue"), "Publisher is not a reviewer");
    assert.equal(fixture.rpc(reviewer, "platform_admin_has_permission", { permission_code: "admin.team.manage" }), false);
    const billing = rpcHttp(reviewer, "market_billing_admin_state");
    assert.ok(billing.status >= 400 && billing.status < 500, `Review membership must not grant billing: HTTP ${billing.status}`);
    assert.ok(["42501", "P0001"].includes(billing.data?.code), "The existing billing permission check must reject the reviewer.");

    const draft = fixture.rpc(developer, "market_registry_save_draft", { p_manifest: manifest() });
    assert.equal(draft.draft_version, 1);
    assert.equal(draft.registry_key, `external-${draft.id}`);
    const workspace = fixture.rpc(developer, "market_registry_workspace");
    assert.equal(workspace.apps.length, 1);
    assert.deepEqual(workspace.apps[0].draft_manifest, manifest({ displayName: "Caf\u00e9 fixture" }));
    assert.deepEqual(workspace.apps[0].submissions, []);
    assert.deepEqual(fixture.rpc(otherDeveloper, "market_registry_workspace").apps, []);
    assertDenied(rpcHttp(otherDeveloper, "market_registry_save_draft", { p_app_id: draft.id, p_expected_version: 1, p_manifest: manifest() }), "Cross-publisher save");
    assertDenied(rpcHttp(otherDeveloper, "market_registry_submit", { p_app_id: draft.id, p_expected_version: 1 }), "Cross-publisher submission");
    const invalid = rpcHttp(developer, "market_registry_save_draft", { p_manifest: manifest({ requestedCapabilities: ["runtime:iframe"] }) });
    assert.equal(invalid.status, 400); assert.equal(invalid.data?.code, "22023");
    const first = fixture.rpc(developer, "market_registry_submit", { p_app_id: draft.id, p_expected_version: 1 });
    assert.equal(first.status, "submitted");
    const canonical = fixture.json(`select to_jsonb(canonical_manifest) from market_private.submissions where id=${uuid(first.id)}`);
    assert.equal(first.manifest_hash, createHash("sha256").update(canonical, "utf8").digest("hex"));
    assert.deepEqual(fixture.rpc(developer, "market_registry_submit", { p_app_id: draft.id, p_expected_version: 1 }), first);
    assertDenied(rpcHttp(otherDeveloper, "market_registry_withdraw", { p_submission_id: first.id, p_expected_hash: first.manifest_hash }), "Cross-publisher withdrawal");
    assertConflict(rpcHttp(developer, "market_registry_save_draft", { p_app_id: draft.id, p_expected_version: 1, p_manifest: manifest({ description: "Unsaved replacement" }) }), "Submitted draft cannot be edited");
    const firstQueue = fixture.rpc(reviewer, "market_registry_review_queue").submissions;
    assert.equal(firstQueue.length, 1); assert.equal(firstQueue[0].previous_manifest, null);
    assert.deepEqual(firstQueue[0].manifest, first.manifest);
    const firstReview = { p_submission_id: first.id, p_expected_version: 1, p_expected_hash: first.manifest_hash,
      p_decision: "rejected", p_reason: "Clarify the synthetic feature description." };
    assertConflict(rpcHttp(reviewer, "market_registry_review", { ...firstReview, p_expected_version: 2 }), "Wrong review revision");
    assertConflict(rpcHttp(reviewer, "market_registry_review", { ...firstReview, p_expected_hash: "0".repeat(64) }), "Wrong review hash");
    const rejected = fixture.rpc(reviewer, "market_registry_review", firstReview);
    assert.equal(rejected.status, "rejected");
    assert.deepEqual(fixture.rpc(reviewer, "market_registry_review", firstReview), rejected);
    const reloaded = fixture.rpc(developer, "market_registry_workspace").apps[0];
    assert.equal(reloaded.submissions[0].review.reason, firstReview.p_reason);
    const revised = fixture.rpc(developer, "market_registry_save_draft", { p_app_id: draft.id, p_expected_version: 1,
      p_manifest: manifest({ appVersion: "1.0.1", description: "Clarified synthetic feature; metadata review only." }) });
    assert.equal(revised.draft_version, 2);
    const second = fixture.rpc(developer, "market_registry_submit", { p_app_id: draft.id, p_expected_version: 2 });
    assert.notEqual(second.id, first.id); assert.notEqual(second.manifest_hash, first.manifest_hash);
    const secondQueue = fixture.rpc(reviewer, "market_registry_review_queue").submissions;
    assert.equal(secondQueue.length, 1); assert.deepEqual(secondQueue[0].previous_manifest, first.manifest);
    evidence.checks.push("Real authenticated developer save/reload/submit/reject/revise flow, tenant denial and reviewer billing isolation.");

    const attempts = [
      { person: reviewer, params: { p_submission_id: second.id, p_expected_version: 2, p_expected_hash: second.manifest_hash,
        p_decision: "metadata_approved", p_reason: "Synthetic metadata approved; no runtime permission." } },
      { person: secondReviewer, params: { p_submission_id: second.id, p_expected_version: 2, p_expected_hash: second.manifest_hash,
        p_decision: "rejected", p_reason: "Second synthetic reviewer requests a clarification." } },
    ];
    const lock = asyncDockerInput(fixture, ["exec", "-i", fixture.evidence.containers.db, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"],
      `begin;select id from market_private.apps where id=${uuid(draft.id)} for update;\n\\echo REGISTRY_LOCK_HELD\nselect pg_sleep(8);commit;`, "REGISTRY_LOCK_HELD");
    pending.push(lock.done);
    await lock.ready;
    const responses = attempts.map(attempt => concurrentReview(fixture, attempt.person, attempt.params));
    for (const promise of responses) { pending.push(promise); void promise.catch(() => {}); }
    let observedWaiting = 0;
    const overlapDeadline = Date.now() + 6500;
    while (Date.now() < overlapDeadline && observedWaiting < 2) {
      observedWaiting = Number(fixture.sql("select count(*) from pg_stat_activity where pid<>pg_backend_pid() and usename='authenticator' and state='active' and wait_event_type='Lock' and strpos(lower(query),'market_registry_review')>0"));
      if (observedWaiting < 2) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const settled = await Promise.all(responses);
    await lock.done;
    assert.equal(observedWaiting, 2, "Both real PostgREST transactions must overlap while waiting for the same fixture app row lock.");
    const winnerIndex = settled.findIndex(response => response.status >= 200 && response.status < 300);
    assert.ok(winnerIndex >= 0, "One review must succeed.");
    assert.equal(settled.filter(response => response.status >= 200 && response.status < 300).length, 1);
    assertConflict(settled[1 - winnerIndex], "Concurrent losing review");
    assert.equal(fixture.sql(`select count(*) from market_private.resolutions where submission_id=${uuid(second.id)}`), "1");
    assert.equal(fixture.sql(`select count(*) from market_private.events where submission_id=${uuid(second.id)} and event_type in ('metadata_approved','rejected')`), "1");
    const winningAttempt = attempts[winnerIndex];
    assert.equal(settled[winnerIndex].data.status, winningAttempt.params.p_decision);
    assert.deepEqual(fixture.rpc(winningAttempt.person, "market_registry_review", winningAttempt.params), settled[winnerIndex].data);
    assertConflict(rpcHttp(attempts[1 - winnerIndex].person, "market_registry_review", attempts[1 - winnerIndex].params), "Losing review remains a conflict on retry");
    assert.deepEqual(fixture.rpc(reviewer, "market_registry_review_queue").submissions, []);
    evidence.concurrency = { overlappingBlockedTransactions: observedWaiting,
      responses: settled.map(response => ({ status: response.status, code: response.data?.code ?? null })),
      resolutionCount: 1, reviewEventCount: 1, idempotentWinnerRetry: true };
    evidence.checks.push("Two overlapping HTTP review transactions serialize to exactly one immutable decision/event.");

    const hashesBeforeErasure = fixture.json(`select jsonb_agg(manifest_hash order by draft_version) from market_private.submissions where app_id=${uuid(draft.id)}`);
    fixture.sql(`update public.users set status='deleted' where id=${uuid(developer.profileId)}`);
    const erased = fixture.json(`select jsonb_build_object(
      'publisher', (select jsonb_build_object('name',p.name,'ownerRemoved',p.owner_user_id is null,'active',p.active,'erased',p.erased_at is not null)
        from market_private.publishers p join market_private.apps a on a.publisher_id=p.id where a.id=${uuid(draft.id)}),
      'appScrubbed', (select draft_manifest is null and erased_at is not null from market_private.apps where id=${uuid(draft.id)}),
      'submissionsScrubbed', (select bool_and(manifest is null and canonical_manifest is null and erased_at is not null) from market_private.submissions where app_id=${uuid(draft.id)}),
      'reasonsScrubbed', (select bool_and(r.reason is null and r.erased_at is not null) from market_private.resolutions r join market_private.submissions s on s.id=r.submission_id where s.app_id=${uuid(draft.id)}),
      'hashes', (select jsonb_agg(manifest_hash order by draft_version) from market_private.submissions where app_id=${uuid(draft.id)}))`);
    assert.deepEqual(erased.publisher, { name: "Deleted publisher", ownerRemoved: true, active: false, erased: true });
    assert.equal(erased.appScrubbed, true); assert.equal(erased.submissionsScrubbed, true); assert.equal(erased.reasonsScrubbed, true);
    assert.deepEqual(erased.hashes, hashesBeforeErasure);
    assertDenied(rpcHttp(developer, "market_registry_workspace"), "Deleted developer with previously valid JWT");
    assertDenied(rpcHttp(reviewer, "market_registry_review", firstReview), "Erased submission is unavailable for review");
    assert.deepEqual(fixture.rpc(otherDeveloper, "market_registry_workspace").apps, []);
    assert.deepEqual(fixture.rpc(reviewer, "market_registry_review_queue").submissions, []);
    fixture.sql(`update public.users set status='deleted' where id=${uuid(secondReviewer.profileId)}`);
    assert.equal(fixture.sql(`select count(*) from market_private.reviewers where user_id=${uuid(secondReviewer.profileId)}`), "0");
    assertDenied(rpcHttp(secondReviewer, "market_registry_review_queue"), "Deleted reviewer with previously valid JWT");
    fixture.sql("update market_private.settings set enabled=false where id");
    assertDenied(rpcHttp(otherDeveloper, "market_registry_workspace"), "Gate can revoke existing developer sessions");
    assertDenied(rpcHttp(reviewer, "market_registry_review_queue"), "Gate can revoke existing reviewer sessions");
    evidence.checks.push("Account status deletion scrubs stored manifests, canonical text and reasons; retained JWTs lose access.");
    evidence.completed = true;
  } catch (error) {
    evidence.error = fixture.redact(error.message);
    throw error;
  } finally {
    // Complete any bounded local requests before removing only helper-owned,
    // label-checked fixture containers. Never affect pre-existing containers.
    await Promise.allSettled(pending);
    try { fixture.save("market-registry-results.json", evidence); }
    finally { fixture.close(); }
  }
});
