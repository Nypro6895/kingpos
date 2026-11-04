import test from "node:test";
import assert from "node:assert/strict";
import { createQrMenuApp } from "../examples/qr-menu/server.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("local sandbox preview uses official endpoints and refuses real data or public origins", async (t) => {
  const token = "rmp_" + "s".repeat(43);
  let synthetic = true;
  const fetcher = async (url) => {
    const group = new URL(url).pathname.split("/").at(-1);
    return Response.json({
      schemaVersion: 1,
      group,
      synthetic,
      salonId: id(1),
      installationId: id(1),
      versionId: id(2),
      revision: 1,
      data: {
        profile: { displayName: "Synthetic", brandColor: "#145946", hours: [] },
        services: { services: [] },
        media: { images: [] },
        content: { entries: [] },
      }[group],
    });
  };
  assert.throws(
    () =>
      createQrMenuApp({
        api: "https://reylumi.com",
        publicOrigin: "https://public-company.com",
        sandboxToken: token,
        fetcher,
      }),
    /loopback/,
  );
  const server = createQrMenuApp({
    api: "http://127.0.0.1:4328",
    publicOrigin: "http://127.0.0.1:4344",
    sandboxToken: token,
    fetcher,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/sandbox", { redirect: "manual" });
  assert.equal(response.status, 303);
  synthetic = false;
  assert.equal(
    (await fetch(url + "/sandbox", { redirect: "manual" })).status,
    403,
  );
});
