import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const enabled = Boolean(process.env.ESBUILD_MODULE_PATH);
async function actions() {
  const { build } = await import(
    pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
  );
  const built = await build({
    entryPoints: ["app/(app)/admin/advertising/actions.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "admin-context",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(next\/cache|@\/lib\/(platform-admin\/(auth|permissions)|explore-advertising))$/,
            },
            (args) => ({ path: args.path, namespace: "stub" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "js",
            contents:
              args.path === "next/cache"
                ? "export function revalidatePath(){}"
                : args.path.endsWith("/permissions")
                  ? 'export const PLATFORM_ADMIN_PERMISSIONS={businessesUpdate:"admin.businesses.update"};'
                  : args.path.endsWith("/auth")
                    ? 'export async function requirePlatformAdmin(permission){globalThis.adCalls.push(permission);if(!globalThis.adAuthorized)throw new Error("Denied");return {userId:"1650370b-f86d-461e-8d97-6210052eeed7"};}'
                    : `export function advertisingClient(){return {from:()=>({upsert:async row=>{globalThis.adRows.push(row);return {error:null};}}),storage:{from:()=>({createSignedUploadUrl:async path=>({data:{token:'upload-token'},error:null}),getPublicUrl:path=>({data:{publicUrl:'https://images.example.com/'+path}})})}};}`,
          }));
        },
      },
    ],
  });
  return await import(
    "data:text/javascript;base64," +
      Buffer.from(built.outputFiles[0].text).toString("base64")
  );
}
test(
  "campaign mutations require management permission; authorized settings persist",
  { skip: !enabled },
  async () => {
    globalThis.adCalls = [];
    globalThis.adRows = [];
    globalThis.adAuthorized = false;
    const { saveCampaignAction } = await actions();
    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: "Offer",
      kind: "popup",
      imageUrl: "https://images.example.com/promo.gif",
      href: "/explore",
      enabled: "on",
      repeat: "daily",
      position: "top",
      delaySeconds: "3",
      durationSeconds: "10",
      speedSeconds: "25",
      background: "#ffffff",
      color: "#302326",
      closeButton: "on",
    }))
      form.set(key, value);
    await assert.rejects(
      () => saveCampaignAction({ ok: false, message: "" }, form),
      /Denied/,
    );
    assert.equal(globalThis.adRows.length, 0);
    assert.equal(globalThis.adCalls[0], "admin.businesses.update");
    globalThis.adAuthorized = true;
    const result = await saveCampaignAction({ ok: false, message: "" }, form);
    assert.equal(result.ok, true);
    assert.equal(globalThis.adRows[0].config.repeat, "daily");
    assert.equal(globalThis.adRows[0].config.enabled, true);
    assert.equal(
      globalThis.adRows[0].config.imageUrl,
      "https://images.example.com/promo.gif",
    );
    form.set("id", result.id);
    await saveCampaignAction(result, form);
    assert.equal(globalThis.adRows[1].id, result.id);
  },
);
test(
  "upload signing is permission gated and rejects non-images or oversized files",
  { skip: !enabled },
  async () => {
    globalThis.adCalls = [];
    globalThis.adRows = [];
    globalThis.adAuthorized = false;
    const { campaignImageUploadAction } = await actions();
    await assert.rejects(
      () => campaignImageUploadAction("image/gif", 2000),
      /Denied/,
    );
    globalThis.adAuthorized = true;
    await assert.rejects(() =>
      campaignImageUploadAction("image/svg+xml", 2000),
    );
    await assert.rejects(() =>
      campaignImageUploadAction("image/gif", 10485761),
    );
    const upload = await campaignImageUploadAction("image/gif", 2000);
    assert.equal(upload.token, "upload-token");
    assert.match(upload.path, /^uploads\/[0-9a-f-]+\.gif$/);
  },
);
