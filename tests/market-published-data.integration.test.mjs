import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { build } from "esbuild";
const modelBuild = await build({entryPoints:["lib/market-platform/owner-read-model.ts"],bundle:true,write:false,platform:"node",format:"esm",alias:{"@":process.cwd()}});
const {readOwnerMarketplace} = await import("data:text/javascript;base64,"+Buffer.from(modelBuild.outputFiles[0].text).toString("base64"));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  hash = (s) => createHash("sha256").update(s).digest("hex");
const manifest = (
  scopes = [
    "salon:profile:read",
    "salon:services:read",
    "salon:media:read",
    "salon:content:read",
  ],
  version = "1.0.0",
) => ({
  schemaVersion: 1,
  type: "hosted-app",
  version,
  name: "Synthetic QR menu",
  description: "Synthetic public menu for bounded integration testing.",
  launchUrl: "https://developer.reylumi.com/connect",
  privacyUrl: "https://developer.reylumi.com/privacy",
  supportUrl: "https://developer.reylumi.com/support",
  scopes,
  price: { currency: "usd", amountCents: 0, billing: "one-time-version" },
});
const profile = {
  displayName: "Public Salon A",
  tagline: "Public only",
  businessPhone: "+1 555 0100",
  businessAddress: "Published business address",
  website: "https://reylumi.com",
  timezone: "America/Chicago",
  brandColor: "#145946",
  hours: [{ day: 1, closed: false, opens: "09:00", closes: "18:00" }],
};
const services = {
  services: [
    {
      id: id(100),
      name: "Manicure",
      category: "Nails",
      description: "Public list",
      priceKind: "from",
      amountCents: 2500,
      currency: "USD",
      durationMinutes: null,
    },
  ],
};
const media = {
  images: [
    {
      assetId: id(80),
      label: "Salon interior",
      caption: "Synthetic selected asset",
      rights: "owner",
      role: "gallery",
    },
  ],
};
const content = {
  entries: [
    {
      id: id(90),
      kind: "faq",
      title: "What is listed?",
      body: "Published salon information only.",
    },
  ],
};
test("four published groups: tenant, exact scope/version, publication revision, photo withdrawal and revocation", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create table users(id uuid primary key,status text default 'active');create table locations(id uuid primary key,name text,owner_id uuid references users(id),status text default 'active');create schema market_private;create table market_private.reviewers(user_id uuid,active boolean default true);create function public.current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.market_billing_require_admin() returns uuid language sql as $$select current_public_user_id()$$;create function public.lifecycle_user_is_salon_owner(s uuid,u uuid,x boolean) returns boolean language sql stable security definer as $$select exists(select 1 from public.locations where id=s and owner_id=u and status='active')$$;create table salon_profile_media_assets(id uuid primary key,salon_id uuid,bucket text,object_path text,purpose text,mime_type text,processed_bytes bigint,status text,deleted_at timestamptz,quarantined_at timestamptz);`,
  );
  for (let n = 1; n <= 4; n++)
    await db.query("insert into users(id) values($1)", [id(n)]);
  await db.query(
    "insert into locations(id,name,owner_id) values($1,'Private original A',$2),($3,'Private original B',$4)",
    [id(20), id(1), id(21), id(2)],
  );
  await db.query("insert into market_private.reviewers(user_id) values($1)", [
    id(3),
  ]);
  for (const name of [
    "20261104230000_market_platform.sql",
    "20261104230100_market_platform_commerce.sql",
    "20261104230200_market_owner_connections.sql",
    "20261104230300_market_developer_tools.sql",
    "20261104230400_market_provider_accounting.sql",
    "20261104230500_market_published_data.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + name, "utf8"));
  await db.exec("update market_platform.settings set enabled=true");
  await db.query(
    "insert into salon_profile_media_assets values($1,$2,'salon-profile-media',$3,'look','image/webp',1000,'active',null,null)",
    [id(80), id(20), id(20) + "/looks/" + id(81) + "/photo.webp"],
  );
  await db.query(
    "insert into salon_profile_media_assets values($1,$2,'salon-profile-media',$3,'look','image/webp',1000,'active',null,null),($4,$5,'salon-profile-media',$6,'staff_avatar','image/webp',1000,'active',null,null)",
    [
      id(82),
      id(21),
      id(21) + "/looks/fixture/photo.webp",
      id(83),
      id(20),
      id(20) + "/staff/fixture/photo.webp",
    ],
  );
  const actor = async (n, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      n ? id(n) : "",
    ]);
    await db.exec("set role " + role);
  };
  const rpc = async (name, args = [], types = []) =>
    (
      await db.query(
        `select public.market_platform_${name}(${args.map((_, i) => `$${i + 1}::${types[i] ?? "text"}`).join(",")}) value`,
        args,
      )
    ).rows[0].value;
  await actor(4);
  await rpc("register", ["Synthetic Developer"]);
  await assert.rejects(
    rpc(
      "submit",
      [null, manifest(["customers:read"]), id(40)],
      ["uuid", "jsonb", "uuid"],
    ),
    /Unsupported/,
  );
  await assert.rejects(
    rpc(
      "submit",
      [null, manifest(["salon:profile:read", "salon:profile:read"]), id(40)],
      ["uuid", "jsonb", "uuid"],
    ),
    /Duplicate/,
  );
  const v = await rpc(
    "submit",
    [null, manifest(), id(40)],
    ["uuid", "jsonb", "uuid"],
  );
  await actor(3);
  await rpc(
    "review",
    [v.id, v.sha256, "approved", "Synthetic immutable public contract"],
    ["uuid", "text", "text", "text"],
  );
  await actor(4);
  const client = "rmc_" + "c".repeat(43);
  await rpc("rotate_client", [v.app_id, hash(client)], ["uuid", "text"]);
  async function connect(version, rawSuffix) {
    await actor(1);
    const install = await rpc(
      "install",
      [id(20), version.id, version.sha256, version.manifest.scopes],
      ["uuid", "uuid", "text", "jsonb"],
    );
    const observed = await rpc("owner_workspace", [id(20)], ["uuid"]);
    assert.ok(readOwnerMarketplace(observed,id(20)), "Current four-group/reduced-scope SQL workspace must pass the read contract");
    const code = "rma_" + rawSuffix.repeat(43),
      verifier = "v".repeat(43),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    await rpc(
      "authorize",
      [id(20), install.id, v.app_id, challenge, hash(code)],
      ["uuid", "uuid", "uuid", "text", "text"],
    );
    const token = "rmp_" + rawSuffix.repeat(43);
    await actor(null, "anon");
    await rpc(
      "exchange_code",
      [
        v.app_id,
        client,
        code,
        verifier,
        hash(token),
        hash("rmr_" + rawSuffix.repeat(43)),
      ],
      ["uuid", "text", "text", "text", "text", "text"],
    );
    return { install, token };
  }
  const live = await connect(v, "a");
  await t.test(
    "default deny: no published group or private-source fallback",
    async () => {
      for (const g of ["profile", "services", "media", "content"])
        await assert.rejects(
          rpc("published_group", [live.token, g]),
          /not published/,
        );
      await assert.rejects(
        rpc("published_media_source", [live.token, id(80)], ["text", "uuid"]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select market_platform.publication_authority($1,$2)", [
          live.token,
          "profile",
        ]),
        /permission denied/,
      );
    },
  );
  const save = (g, data, revision = 0, publish = true) =>
    rpc(
      "publish_group",
      [id(20), g, revision, data, publish],
      ["uuid", "text", "integer", "jsonb", "boolean"],
    );
  await t.test(
    "owner-only, stale salon/revision, strict allowlist and photo rights",
    async () => {
      await actor(2);
      await assert.rejects(save("profile", profile), /Owner/);
      await actor(1);
      await assert.rejects(
        save("profile", { ...profile, displayName: "  " }),
        /text/,
      );
      const selection = await rpc("publication_workspace", [id(20)], ["uuid"]);
      assert.deepEqual(
        selection.assets.map((a) => a.id),
        [id(80)],
      );
      for (const foreign of [id(82), id(83)])
        await assert.rejects(
          save("media", { images: [{ ...media.images[0], assetId: foreign }] }),
          /rights/,
        );
      await assert.rejects(
        save("profile", { ...profile, customerPhone: "private" }),
        /fields/,
      );
      await assert.rejects(
        save("services", {
          services: [
            { ...services.services[0], priceKind: "fixed", amountCents: 1.25 },
          ],
        }),
        /integer/,
      );
      await assert.rejects(
        save("media", { images: [{ ...media.images[0], rights: "unknown" }] }),
        /rights/,
      );
      await assert.rejects(
        save("media", { images: [{ ...media.images[0], assetId: id(999) }] }),
        /rights/,
      );
      assert.equal(await save("profile", profile), 1);
      await assert.rejects(save("profile", profile), /changed/);
      assert.equal(await save("services", services), 1);
      assert.equal(await save("media", media), 1);
      assert.equal(await save("content", content), 1);
    },
  );
  await t.test(
    "four projections contain only curated fields and selected photo metadata",
    async () => {
      await actor(null, "anon");
      for (const [g, p] of Object.entries({
        profile,
        services,
        media,
        content,
      })) {
        const out = await rpc("published_group", [live.token, g]);
        assert.equal(out.salonId, id(20));
        assert.equal(out.versionId, v.id);
        assert.deepEqual(out.data, p);
        assert.ok(!JSON.stringify(out).includes("Private original"));
        assert.ok(!JSON.stringify(out).includes("object_path"));
      }
      await actor(null, "service_role");
      const source = await rpc(
        "published_media_source",
        [live.token, id(80)],
        ["text", "uuid"],
      );
      assert.equal(source.assetId, id(80));
    },
  );
  await t.test(
    "unpublish/update immediately affect same token; images rechecked after quarantine/unshare",
    async () => {
      await actor(1);
      assert.equal(await save("profile", null, 1, false), 2);
      await actor(null, "anon");
      await assert.rejects(
        rpc("published_group", [live.token, "profile"]),
        /not published/,
      );
      await actor(1);
      await save("profile", { ...profile, displayName: "New public name" }, 2);
      await actor(null, "anon");
      assert.equal(
        (await rpc("published_group", [live.token, "profile"])).data
          .displayName,
        "New public name",
      );
      await db.exec("reset role");
      await db.query(
        "update salon_profile_media_assets set status='quarantined' where id=$1",
        [id(80)],
      );
      await actor(null, "anon");
      assert.deepEqual(
        (await rpc("published_group", [live.token, "media"])).data.images,
        [],
      );
      await actor(null, "service_role");
      await assert.rejects(
        rpc("published_media_source", [live.token, id(80)], ["text", "uuid"]),
        /unavailable/,
      );
      await actor(1);
      await save("media", { images: [] }, 1);
    },
  );
  await t.test(
    "new version needs approval/consent and invalidates old grant; four scopes stay independent",
    async () => {
      await actor(4);
      const next = await rpc(
        "submit",
        [v.app_id, manifest(["salon:profile:read"], "1.1.0"), id(41)],
        ["uuid", "jsonb", "uuid"],
      );
      await actor(1);
      await assert.rejects(
        rpc(
          "install",
          [id(20), next.id, next.sha256, next.manifest.scopes],
          ["uuid", "uuid", "text", "jsonb"],
        ),
        /approved/,
      );
      await actor(3);
      await rpc(
        "review",
        [next.id, next.sha256, "approved", "Profile-only synthetic update"],
        ["uuid", "text", "text", "text"],
      );
      const n = await connect(next, "b");
      await assert.rejects(
        rpc("published_group", [live.token, "profile"]),
        /revoked/,
      );
      assert.equal(
        (await rpc("published_group", [n.token, "profile"])).salonId,
        id(20),
      );
      for (const g of ["services", "media", "content"])
        await assert.rejects(
          rpc("published_group", [n.token, g]),
          /permission/,
        );
      await actor(1);
      await rpc("revoke", [n.install.id], ["uuid"]);
      await actor(null, "anon");
      await assert.rejects(
        rpc("published_group", [n.token, "profile"]),
        /revoked/,
      );
    },
  );
  await t.test(
    "sandbox is version-scoped, synthetic and bounded; no live salon data copied",
    async () => {
      await actor(4);
      const token = "rmp_" + "s".repeat(43);
      await rpc("sandbox", [v.id, hash(token)], ["uuid", "text"]);
      await actor(null, "anon");
      for (const g of ["profile", "services", "media", "content"]) {
        const out = await rpc("published_group", [token, g]);
        assert.equal(out.synthetic, true);
        assert.notEqual(out.salonId, id(20));
      }
      await actor(4);
      const tools = await rpc("developer_tools");
      assert.equal(tools.sandboxGroups.length, 4);
      assert.ok(tools.sandboxGroups.every((g) => g.calls === 1));
      await rpc(
        "sandbox",
        [v.id, hash("rmp_" + "z".repeat(43))],
        ["uuid", "text"],
      );
      assert.equal((await rpc("developer_tools")).sandboxGroups.length, 0);
      await actor(null, "anon");
      await assert.rejects(
        rpc("published_group", [token, "profile"]),
        /permission/,
      );
      await db.exec("reset role");
      await db.query(
        "update market_platform.sandboxes set request_count=1000 where version_id=$1",
        [v.id],
      );
      await actor(null, "anon");
      await assert.rejects(
        rpc("published_group", ["rmp_" + "z".repeat(43), "profile"]),
        /permission/,
      );
    },
  );
});
