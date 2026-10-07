import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const output = ts.transpileModule(
  fs.readFileSync("lib/explore-advertising-rules.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { parseCampaign, campaignActive, chooseCampaign, safeCampaignUrl } =
  await import(
    "data:text/javascript;base64," + Buffer.from(output).toString("base64")
  );
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    name: "First visit",
    kind: "popup",
    imageUrl: "https://example.com/offer.gif",
    href: "/explore",
    repeat: "daily",
    position: "top",
    background: "#ffffff",
    color: "#302326",
    delaySeconds: "5",
    durationSeconds: "15",
    speedSeconds: "25",
    enabled: "on",
    closeButton: "on",
    ...overrides,
  }))
    if (value !== null) data.set(key, value);
  return data;
}
test("campaign schedule and pause govern eligibility", () => {
  const c = parseCampaign(
    form({ startsAt: "2026-10-06T12:00Z", endsAt: "2026-10-07T12:00Z" }),
  );
  assert.equal(campaignActive(c, Date.parse("2026-10-06T11:00Z")), false);
  assert.equal(campaignActive(c, Date.parse("2026-10-06T12:00Z")), true);
  assert.equal(campaignActive(c, Date.parse("2026-10-07T12:00Z")), false);
  assert.equal(
    campaignActive({ ...c, enabled: false }, Date.parse("2026-10-06T13:00Z")),
    false,
  );
});
test("rotation avoids the previous campaign when alternatives exist", () => {
  assert.equal(
    chooseCampaign([{ id: "a" }, { id: "b" }], "a", () => 0).id,
    "b",
  );
  assert.equal(chooseCampaign([{ id: "a" }], "a").id, "a");
  assert.equal(chooseCampaign([]), null);
});
test("unclosable indefinite popups and invalid ranges are rejected", () => {
  assert.throws(() =>
    parseCampaign(form({ closeButton: null, durationSeconds: "0" })),
  );
  assert.throws(() => parseCampaign(form({ delaySeconds: "-1" })));
  assert.throws(() =>
    parseCampaign(
      form({ startsAt: "2026-10-07T12:00Z", endsAt: "2026-10-06T12:00Z" }),
    ),
  );
  assert.doesNotThrow(() =>
    parseCampaign(form({ closeButton: null, durationSeconds: "10" })),
  );
});
test("campaign destinations reject active content and protocol-relative URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.test",
    "/\\evil.test",
    "https://user:password@example.com",
  ])
    assert.throws(() => safeCampaignUrl(url));
  assert.equal(
    safeCampaignUrl("/explore?category=Nails"),
    "/explore?category=Nails",
  );
  assert.equal(
    safeCampaignUrl("https://example.com/a.gif"),
    "https://example.com/a.gif",
  );
});
test("images and links are optional and saved/stopped states stay distinct", () => {
  const draft = parseCampaign(
    form({ imageUrl: "", href: "", text: "Welcome", status: "draft" }),
  );
  assert.equal(draft.enabled, false);
  assert.equal(draft.status, "draft");
  const stopped = parseCampaign(form({ status: "stopped" }));
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.status, "stopped");
});
test("validation identifies every invalid field", () => {
  assert.throws(
    () =>
      parseCampaign(
        form({
          href: "javascript:alert(1)",
          delaySeconds: "-1",
          endsAt: "2026-10-06",
          startsAt: "2026-10-07",
        }),
      ),
    (error) =>
      Boolean(
        error.fields.href && error.fields.delaySeconds && error.fields.endsAt,
      ),
  );
});
