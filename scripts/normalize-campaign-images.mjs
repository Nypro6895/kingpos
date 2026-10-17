// Preview by default. Apply only as a separately authorized maintenance step, after backup/review.
// node --env-file=.env.local scripts/normalize-campaign-images.mjs [--apply]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some(arg => !["--apply", "--dry-run"].includes(arg))) throw Error("Use --dry-run (default) or --apply.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw Error("Storage configuration is required.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bundled = await build({ stdin: { resolveDir: process.cwd(), contents: 'export {storeAdminCampaignImage} from "./lib/campaign-image-storage";export {normalizeImage} from "./lib/normalize-image";', loader: "ts" },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external", plugins: [{ name: "server-only", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "" }));
  } }] });
const runtimeModule = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), runtimeModule, runtimeModule.exports);
const { storeAdminCampaignImage, normalizeImage } = runtimeModule.exports;
async function* rows(table, columns) {
  for (let start = 0; ; start += 100) {
    const { data, error } = await client.from(table).select(columns).order("id").range(start, start + 99);
    if (error) throw Error(`Could not read ${table}.`);
    yield* data; if (data.length < 100) break;
  }
}
let planned = 0, changed = 0;
for await (const row of rows("explore_campaigns", "id,config,updated_at")) {
  if (!row.config.imageUrl || row.config.kind === "ticker" || (row.config.imageVariants?.length && row.config.imageUrl.includes("/optimized/v1/"))) continue;
  planned++;
  if (apply) {
    const image = await storeAdminCampaignImage(row.config.imageUrl);
    const { data, error } = await client.from("explore_campaigns").update({ config: { ...row.config, imageUrl: image.url, imageWidth: image.width, imageHeight: image.height, imageVariants: image.variants }, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("updated_at", row.updated_at).select("id");
    if (error || data?.length !== 1) throw Error(`Campaign changed during maintenance: ${row.id}. No concurrent edit was overwritten.`);
    changed++;
  }
  console.log(JSON.stringify({ kind: "admin", id: row.id, action: apply ? "normalized" : "would-normalize" }));
}
for await (const row of rows("owner_campaign_creatives", "id,salon_id,author_user_id,media_path")) {
  if (!row.media_path || row.media_path.endsWith("/v1/main.webp")) continue;
  planned++;
  if (apply) {
    const storage = client.storage.from("campaign-creatives");
    const { data: file, error: readError } = await storage.download(row.media_path);
    if (readError || !file) throw Error(`Creative unavailable: ${row.id}`);
    const image = await normalizeImage(new Uint8Array(await file.arrayBuffer()));
    const hash = createHash("sha256").update(image.data).digest("hex");
    const folder = `${row.salon_id}/${row.author_user_id}/${row.id}/optimized-${hash}/v1`;
    for (const edge of [1600, 480, 960]) {
      const variant = edge === 1600 ? image : await normalizeImage(image.data, { maxWidth: edge, maxHeight: edge, targetBytes: edge === 480 ? 80 * 1024 : 180 * 1024 });
      const { error } = await storage.upload(`${folder}/${edge === 1600 ? "main" : "w" + edge}.webp`, variant.data, { contentType: "image/webp", upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw Error(`Creative upload failed: ${row.id}`);
    }
    const { data, error } = await client.from("owner_campaign_creatives").update({ media_path: `${folder}/main.webp` }).eq("id", row.id).eq("media_path", row.media_path).select("id");
    if (error || data?.length !== 1) throw Error(`Creative changed during maintenance: ${row.id}. No concurrent edit was overwritten.`);
    changed++;
  }
  console.log(JSON.stringify({ kind: "customer", id: row.id, action: apply ? "normalized" : "would-normalize" }));
}
console.log(JSON.stringify({ apply, planned, changed, originalsRetained: true }));
