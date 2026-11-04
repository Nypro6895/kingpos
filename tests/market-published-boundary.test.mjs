import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import sharp from "sharp";
const key = Symbol.for("published-route-tests"),
  state = { calls: [], enabled: true, error: null, source: null, sharp };
globalThis[key] = state;
const outputs = await build({
  entryPoints: {
    group: "app/api/market-platform/v1/published/[group]/route.ts",
    action: "app/market/data/actions.ts",
    media: "app/api/market-platform/v1/published/media/[asset]/route.ts",
  },
  bundle: true,
  write: false,
  outdir: "out",
  platform: "node",
  format: "esm",
  alias: { "@": process.cwd() },
  plugins: [
    {
      name: "boundary",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(sharp|server-only|\.\/server|@\/lib\/market-platform\/(server|owner)|@supabase\/supabase-js)$/,
          },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents:
            a.path === "sharp"
              ? `export default globalThis[Symbol.for('published-route-tests')].sharp;`
              : a.path === "server-only"
                ? ""
                : a.path.endsWith("/owner")
                  ? `import{PlatformError}from'@/lib/market-platform/server';export async function currentOwnerSalon(v){if(v!=='salon-a')throw new PlatformError('Salon changed');return v;}`
                  : a.path.endsWith("/server")
                    ? `export class PlatformError extends Error{constructor(message,outcome="rejected"){super(message);this.outcome=outcome;}};export function platformEnabled(){return globalThis[Symbol.for('published-route-tests')].enabled;}export async function platformRpc(name,args){globalThis[Symbol.for('published-route-tests')].calls.push({name,args});return globalThis[Symbol.for('published-route-tests')].ack ?? args.p_expected+1;}`
                    : `export function createClient(url,key){return{rpc:async(name,args)=>{const s=globalThis[Symbol.for('published-route-tests')];s.calls.push({name,args,key});return{data:s.source??{schemaVersion:1,group:args.p_group,data:{}},error:s.error};}};}`,
        }));
      },
    },
  ],
});
const modules = {};
for (const f of outputs.outputFiles) {
  const name = f.path.match(/([^/\\]+)\.js$/)[1];
  modules[name] = await import(
    "data:text/javascript;base64," + Buffer.from(f.text).toString("base64")
  );
}
const names = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const originalFetch = globalThis.fetch;
const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis[key];
  for (const n of names)
    if (prior[n] === undefined) delete process.env[n];
    else process.env[n] = prior[n];
});
test.beforeEach(() => {
  state.calls = [];
  state.enabled = true;
  state.error = null;
  state.source = null;
  globalThis.fetch = originalFetch;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:4329";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-public";
});
const token = "rmp_" + "t".repeat(43),
  req = (path = "profile", query = "") =>
    new Request(
      "http://localhost/api/market-platform/v1/published/" + path + query,
      { headers: { Authorization: "Bearer " + token } },
    );
test("actual route rejects missing auth, tenant/field overrides and unsupported groups before RPC", async () => {
  assert.equal(
    (
      await modules.group.GET(new Request("http://localhost/api"), {
        params: Promise.resolve({ group: "profile" }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await modules.group.GET(req("profile", "?salon=other"), {
        params: Promise.resolve({ group: "profile" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await modules.group.GET(req("customers"), {
        params: Promise.resolve({ group: "customers" }),
      })
    ).status,
    404,
  );
  assert.equal(state.calls.length, 0);
});
test("each group maps only to token-bound official RPC with no-store and fail-closed status", async () => {
  for (const group of ["profile", "services", "media", "content"]) {
    const r = await modules.group.GET(req(group), {
      params: Promise.resolve({ group }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.equal(state.calls.at(-1).name, "market_platform_published_group");
    assert.deepEqual(state.calls.at(-1).args, {
      p_token: token,
      p_group: group,
    });
  }
  state.error = { code: "42501" };
  assert.equal(
    (
      await modules.group.GET(req(), {
        params: Promise.resolve({ group: "profile" }),
      })
    ).status,
    403,
  );
  state.error = { code: "PT404" };
  assert.equal(
    (
      await modules.group.GET(req(), {
        params: Promise.resolve({ group: "profile" }),
      })
    ).status,
    404,
  );
  state.enabled = false;
  assert.equal(
    (
      await modules.group.GET(req(), {
        params: Promise.resolve({ group: "profile" }),
      })
    ).status,
    503,
  );
});
function form(extra = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    salon: "salon-a",
    group: "profile",
    revision: "0",
    payload: "{}",
    intent: "publish",
    ...extra,
  }))
    f.set(k, v);
  return f;
}
test("Owner action requires exact current salon, confirmation, bounds and unique fields", async () => {
  assert.equal((await modules.action.savePublication({}, form())).ok, false);
  assert.equal(
    (
      await modules.action.savePublication(
        {},
        form({ consent: "yes", salon: "salon-b" }),
      )
    ).ok,
    false,
  );
  const duplicate = form({ consent: "yes" });
  duplicate.append("group", "media");
  assert.equal((await modules.action.savePublication({}, duplicate)).ok, false);
  assert.equal(
    (
      await modules.action.savePublication(
        {},
        form({ consent: "yes", payload: "x".repeat(131073) }),
      )
    ).ok,
    false,
  );
  assert.equal(state.calls.length, 0);
  assert.equal(
    (await modules.action.savePublication({}, form({ consent: "yes" }))).ok,
    true,
  );
  assert.deepEqual(state.calls[0].args, {
    p_salon: "salon-a",
    p_group: "profile",
    p_expected: 0,
    p_data: {},
    p_intent: "publish",
  });
  state.calls = [];
  assert.equal(
    (await modules.action.savePublication({}, form({ intent: "unpublish" })))
      .ok,
    true,
  );
  assert.equal(state.calls[0].args.p_data, null);
  assert.equal(state.calls[0].args.p_intent, "unpublish");
});
test("actual media gateway fails closed without private config and strips original metadata without revealing paths", async () => {
  const asset = "00000000-0000-4000-8000-000000000080",
    salon = "00000000-0000-4000-8000-000000000020";
  assert.equal(
    (
      await modules.media.GET(req("media/" + asset), {
        params: Promise.resolve({ asset }),
      })
    ).status,
    503,
  );
  assert.equal(state.calls.length, 0);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-private-server-only";
  state.source = {
    salonId: salon,
    assetId: asset,
    bucket: "salon-profile-media",
    path: salon + "/looks/fixture/photo.webp",
  };
  const original = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#abd0ba" },
  })
    .png()
    .withMetadata({ exif: { IFD0: { Artist: "Private original" } } })
    .toBuffer();
  let fetched;
  globalThis.fetch = async (url, options) => {
    fetched = { url: String(url), options };
    return new Response(original, { headers: { "Content-Type": "image/png" } });
  };
  const response = await modules.media.GET(req("media/" + asset), {
    params: Promise.resolve({ asset }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(state.calls.at(-1).key, "test-private-server-only");
  assert.equal(
    state.calls.at(-1).name,
    "market_platform_published_media_source",
  );
  assert.equal(fetched.options.redirect, "error");
  assert.equal(new URL(fetched.url).hostname, "localhost");
  assert.equal(
    (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).exif,
    undefined,
  );
  state.source.path = "other-salon/private/original.webp";
  fetched = null;
  assert.equal(
    (
      await modules.media.GET(req("media/" + asset), {
        params: Promise.resolve({ asset }),
      })
    ).status,
    404,
  );
  assert.equal(fetched, null);
});

test('publication acknowledgement must be exactly the next edit revision',async()=>{state.ack=9;try{const result=await modules.action.savePublication({},form({intent:'draft'}));assert.equal(result.ok,false);assert.equal(result.uncertain,true);}finally{delete state.ack;}});

test('fixed synthetic image still requires a scoped synthetic media response, no storage key or external fetch',async()=>{delete process.env.SUPABASE_SERVICE_ROLE_KEY;const asset='00000000-0000-4000-8000-000000000003';state.source={synthetic:true,data:{images:[{assetId:asset}]}};globalThis.fetch=()=>{throw Error('No external image fetch allowed');};let r=await modules.media.GET(req('media/'+asset),{params:Promise.resolve({asset})});assert.equal(r.status,200);const m=await sharp(Buffer.from(await r.arrayBuffer())).metadata();assert.equal(m.width,160);assert.equal(m.exif,undefined);state.error={code:'42501'};r=await modules.media.GET(req('media/'+asset),{params:Promise.resolve({asset})});assert.equal(r.status,403);});

test('stopping sharing or discarding does not parse or validate edited draft payload',async()=>{for(const intent of ['unpublish','discard']){const result=await modules.action.savePublication({},form({intent,payload:'x'.repeat(131073)}));assert.equal(result.ok,true);assert.equal(state.calls.at(-1).args.p_data,null);}});

test('publication and image budget denials return 429 without stale data or a storage fetch',async()=>{state.error={code:'PT429'};globalThis.fetch=()=>{throw Error('Budget denial must not fetch storage');};let r=await modules.group.GET(req('profile'),{params:Promise.resolve({group:'profile'})});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');const asset='00000000-0000-4000-8000-000000000003';r=await modules.media.GET(req('media/'+asset),{params:Promise.resolve({asset})});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');});
