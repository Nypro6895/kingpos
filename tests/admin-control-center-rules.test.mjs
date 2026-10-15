import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function load(path) {
  const result=await build({entryPoints:[path],bundle:true,write:false,platform:"node",format:"esm"});
  return import("data:text/javascript;base64,"+Buffer.from(result.outputFiles[0].text).toString("base64"));
}
test("user exports neutralize formulas and preserve commas, quotes and line breaks",async()=>{
  const {adminCsvCell}=await load("lib/platform-admin/csv.ts");
  assert.equal(adminCsvCell('=HYPERLINK("https://example.invalid")'),'"\'=HYPERLINK(""https://example.invalid"")"');
  assert.equal(adminCsvCell("  +15550000000"),'"\'  +15550000000"');
  assert.equal(adminCsvCell("@SUM(A1)"),'"\'@SUM(A1)"');
  assert.equal(adminCsvCell('Name, "quoted"\nnext line'),'"Name, ""quoted""\nnext line"');
  assert.equal(adminCsvCell(null),'""');
});
test("review queues filter before paging and prioritize oldest pending requests without changing the source",async()=>{
  const {filterAdminReviewQueue}=await load("lib/admin-review-queue.ts");
  const rows=[{id:"new",status:"waiting",created_at:"2026-10-07",name:"Lumi"},{id:"closed",status:"approved",created_at:"2026-10-01",name:"Lumi"},{id:"old",status:"waiting",created_at:"2026-10-03",name:"Lumi"},{id:"other",status:"waiting",created_at:"2026-10-02",name:"Other"}];
  const queue=filterAdminReviewQueue(rows,{q:" lumi ",status:"waiting",page:1,pageSize:1},row=>row.name);
  assert.equal(queue.total,2);assert.equal(queue.items[0].id,"old");assert.equal(rows[0].id,"new");
  assert.equal(filterAdminReviewQueue(rows,{q:"lumi",status:"waiting",page:2,pageSize:1},row=>row.name).items[0].id,"new");
  assert.equal(filterAdminReviewQueue(rows,{status:"waiting",sort:"newest",page:1,pageSize:25},row=>row.name).items[0].id,"new");
});
