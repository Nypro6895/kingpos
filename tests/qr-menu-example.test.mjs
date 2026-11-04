import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import jsQR from "jsqr";
import { createQrMenuApp, listPrice } from "../examples/qr-menu/server.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("list prices preserve from/unknown/zero and currency minor units", () => {
  assert.equal(
    listPrice({ priceKind: "fixed", amountCents: 0, currency: "USD" }),
    "$0.00",
  );
  assert.equal(
    listPrice({ priceKind: "from", amountCents: 2500, currency: "USD" }),
    "From $25.00",
  );
  assert.equal(
    listPrice({ priceKind: "on-request", amountCents: null, currency: "USD" }),
    "Price on request",
  );
  assert.equal(
    listPrice({ priceKind: "fixed", amountCents: 2500, currency: "JPY" }),
    "¥2,500",
  );
});
test("QR menu actual loopback HTTP and decodable PNG, with official API network fixture only", async (t) => {
  const client = id(1),
    secret = "rmc_" + "c".repeat(43),
    access = "rmp_" + "a".repeat(43),
    refresh = "rmr_" + "r".repeat(43),
    install = id(2),
    salon = id(3),
    version = id(4),
    asset = id(8);
  let challenge,
    revoked = false,
    unpublished = false,
    mediaShared = true,
    name = "Synthetic Salon",
    wrongTenant = false;
  const calls = [];
  const picture = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#8ab7a6" },
  })
    .webp()
    .toBuffer();
  const fetcher = async (url, options = {}) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.pathname.endsWith("/token")) {
      const b = JSON.parse(options.body);
      assert.equal(b.client_id, client);
      assert.equal(b.client_secret, secret);
      if (b.grant_type === "refresh_token")
        return Response.json({ error: "revoked" }, { status: 403 });
      assert.equal(
        createHash("sha256").update(b.code_verifier).digest("base64url"),
        challenge,
      );
      return Response.json({
        access_token: access,
        refresh_token: refresh,
        refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
    }
    assert.equal(options.headers.Authorization, "Bearer " + access);
    if (revoked) return Response.json({ error: "revoked" }, { status: 403 });
    const group = u.pathname.split("/").at(-1);
    if (group === asset)
      return new Response(picture, {
        headers: { "Content-Type": "image/webp" },
      });
    if (unpublished && group === "services")
      return Response.json({ error: "not published" }, { status: 404 });
    const data = {
      profile: {
        displayName: name,
        tagline: "<script>bad()</script>",
        businessPhone: "",
        businessAddress: "Public address",
        website: "https://reylumi.com",
        timezone: "America/Chicago",
        brandColor: "#145946",
        hours: [],
      },
      services: {
        services: [
          {
            id: id(7),
            name: "Public manicure",
            description: "Published only",
            category: "Nails",
            priceKind: "from",
            amountCents: 2500,
            currency: "USD",
            durationMinutes: null,
          },
        ],
      },
      media: {
        images: mediaShared
          ? [
              {
                assetId: asset,
                label: "Synthetic interior",
                caption: "Generated fixture image",
                rights: "owner",
                role: "gallery",
              },
            ]
          : [],
      },
      content: {
        entries: [
          {
            id: id(9),
            kind: "faq",
            title: "Synthetic FAQ",
            body: "Plain text only.",
          },
        ],
      },
    }[group];
    assert.ok(data, "Unexpected API path");
    return Response.json({
      schemaVersion: 1,
      group,
      salonId: wrongTenant && group === "services" ? id(99) : salon,
      versionId: version,
      installationId: install,
      revision: 1,
      synthetic: true,
      data,
    });
  };
  const app = createQrMenuApp({
    api: "http://127.0.0.1:4328",
    clientId: client,
    clientSecret: secret,
    publicOrigin: "http://127.0.0.1:4344",
    fetcher,
    secureCookie: false,
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = "http://127.0.0.1:" + app.address().port;
  const launch = new URL("/connect", base);
  for (const [k, v] of Object.entries({
    reylumi_installation: install,
    reylumi_client_id: client,
    reylumi_authorize_url:
      "http://127.0.0.1:4328/api/market-platform/authorize",
  }))
    launch.searchParams.set(k, v);
  const start = await fetch(launch, { redirect: "manual" });
  assert.equal(start.status, 303);
  const auth = new URL(start.headers.get("location"));
  challenge = auth.searchParams.get("code_challenge");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = new URL("/connect", base);
  callback.searchParams.set("code", "rma_" + "x".repeat(43));
  callback.searchParams.set("state", auth.searchParams.get("state"));
  const complete = await fetch(callback, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(complete.status, 303);
  assert.equal(complete.headers.get("location"), "/manage");
  const manage = await fetch(base + "/manage", { headers: { Cookie: cookie } });
  assert.equal(manage.status, 200);
  const html = await manage.text();
  assert.ok(
    !html.includes(secret) && !html.includes(access) && !html.includes(refresh),
  );
  const menu = html.match(/\/menu\/([a-f0-9-]{36})/)[1];
  await t.test(
    "PNG decodes to URL with no token/secret/PII and SVG downloads",
    async () => {
      const qr = await fetch(base + "/qr/" + menu + ".png?download=1");
      assert.equal(qr.status, 200);
      assert.match(qr.headers.get("content-disposition"), /attachment/);
      const { data, info } = await sharp(Buffer.from(await qr.arrayBuffer()))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const decoded = jsQR(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
      );
      assert.equal(decoded.data, "http://127.0.0.1:4344/menu/" + menu);
      assert.ok(!/rmp_|rmc_|rmr_|\?/.test(decoded.data));
      const svg = await fetch(base + "/qr/" + menu + ".svg?download=1");
      assert.match(svg.headers.get("content-type"), /svg/);
      assert.match(await svg.text(), /<svg/);
    },
  );
  await t.test(
    "menu is responsive HTML, escapes content and proxies selected images",
    async () => {
      const response = await fetch(base + "/menu/" + menu);
      assert.match(response.headers.get("cache-control"), /no-store/);
      const body = await response.text();
      assert.match(body, /width=device-width/);
      assert.match(body, /From \$25\.00/);
      assert.match(body, /Duration not provided/);
      assert.match(body, /Synthetic FAQ/);
      assert.ok(
        body.includes("&lt;script&gt;") && !body.includes("<script>bad"),
      );
      const image = await fetch(base + "/menu/" + menu + "/image/" + asset);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
    },
  );
  await t.test(
    "same QR reflects updates and stops sharing photo without stale fallback",
    async () => {
      name = "New published name";
      const updated = await (await fetch(base + "/menu/" + menu)).text();
      assert.match(updated, /New published name/);
      mediaShared = false;
      assert.equal(
        (await fetch(base + "/menu/" + menu + "/image/" + asset)).status,
        404,
      );
    },
  );
  await t.test(
    "unpublished required group and cross-tenant envelope fail closed",
    async () => {
      unpublished = true;
      assert.equal((await fetch(base + "/menu/" + menu)).status, 404);
      unpublished = false;
      wrongTenant = true;
      const mismatch = await fetch(base + "/menu/" + menu);
      assert.equal(mismatch.status, 503);
      assert.ok(!(await mismatch.text()).includes("Public manicure"));
      wrongTenant = false;
    },
  );
  await t.test(
    "uninstall/scope denial revokes menu and QR even for saved public URL",
    async () => {
      revoked = true;
      assert.equal((await fetch(base + "/menu/" + menu)).status, 410);
      assert.equal((await fetch(base + "/qr/" + menu + ".png")).status, 410);
      assert.ok(
        calls.every((path) => path.startsWith("/api/market-platform/v1/")),
      );
    },
  );
});
