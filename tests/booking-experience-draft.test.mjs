import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { chromium } from "playwright-core";

const sourcePath = "app/book/[salonId]/public-booking-client.tsx";
const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const start = `${date}T15:00:00.000Z`;
const service = (id, extra = false) => ({ id, name: id, isAddOnOnly: extra, addOnIds: id === "mani" ? ["art"] : [], category: "Nails", basePrice: 25, durationMinutes: 30 });
function data(accountId = "alice") {
  return {
    state: "ready", salon: { salonId: "salon" }, currentUser: accountId ? { id: accountId } : null,
    settings: { timezoneIana: "America/Chicago", maximumAdvanceWindowDays: 60, anyProfessionalEnabled: true, splitStaffAppointmentEnabled: true },
    services: [service("mani"), service("pedi"), service("art", true), service("other", true)],
    staff: [{ id: "tracy" }, { id: "lucy" }], staffByService: { mani: ["tracy"], pedi: ["lucy"], art: ["tracy"] },
    initialSelection: { inspiration: null, lookId: null, serviceId: "mani", serviceIds: ["mani"], staffId: "tracy", source: "explore", date },
  };
}
const selection = {
  date, notes: "Keep the design", identityMode: "guest", inspirationRemoved: false,
  selectedServiceIds: ["mani"], selectedAddOnSelections: [{ parentServiceId: "mani", serviceId: "art" }],
  lineStaffByKey: { "service:mani": "tracy", "add_on:mani:art": "tracy" }, staffMode: "specific", staffId: "tracy", selectedSlotStart: start, step: 3,
};

function harness(blocked = false) {
  const records = new Map();
  const storage = {
    get length() { return records.size; }, key(index) { return [...records.keys()][index] ?? null; },
    getItem(key) { if (blocked) throw Error("storage blocked"); return records.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error("storage blocked"); records.set(key, value); },
    removeItem(key) { if (blocked) throw Error("storage blocked"); records.delete(key); },
  };
  const exports = {};
  const source = readFileSync(sourcePath, "utf8") + "\nexport { writeStoredBookingDraft, readStoredBookingDraft, draftStorageKey, clearStoredBookingDraft };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: () => ({}), window: { sessionStorage: storage }, Date, Intl });
  return { ...exports, records, storage };
}

test("booking selections and note survive within the same viewer, salon and intent without personal or payment fields", () => {
  const h = harness(); const context = data();
  assert.equal(h.writeStoredBookingDraft(context, { ...selection, customer: { email: "private@example.com", phone: "5551234567" }, payment: { token: "secret" } }), true);
  const serialized = [...h.records.values()][0];
  assert.doesNotMatch(serialized, /private@example|5551234567|secret|customer|payment/);
  assert.equal(h.readStoredBookingDraft(context).notes, selection.notes);
  assert.equal(h.readStoredBookingDraft(context).selectedSlotStart, start);
  assert.equal(h.readStoredBookingDraft(data("bob")), null);
  assert.equal(h.readStoredBookingDraft(data(null)), null);
  assert.equal(h.readStoredBookingDraft({ ...context, salon: { salonId: "another" } }), null);
  assert.equal(h.readStoredBookingDraft({ ...context, initialSelection: { ...context.initialSelection, staffId: "lucy" } }), null);
});

test("restore removes services, unlinked extras and invalid staff choices using the current catalog", () => {
  const h = harness(); const context = data();
  h.writeStoredBookingDraft(context, { ...selection, selectedServiceIds: ["mani", "removed"], selectedAddOnSelections: [...selection.selectedAddOnSelections, { parentServiceId: "mani", serviceId: "other" }], staffId: "deleted", lineStaffByKey: { "service:mani": "deleted", "add_on:mani:art": "tracy", "service:removed": "lucy" } });
  const restored = h.readStoredBookingDraft(context);
  assert.deepEqual(Array.from(restored.selectedServiceIds), ["mani"]);
  assert.equal(restored.selectedAddOnSelections.length, 1);
  assert.equal(restored.staffId, ""); assert.equal(restored.staffMode, "any");
  assert.equal(restored.lineStaffByKey["service:mani"], undefined);
  assert.equal(restored.lineStaffByKey["service:removed"], undefined);
  assert.equal(restored.selectedSlotStart, ""); assert.equal(restored.step, 0);
});

test("expired, invalid and obsolete contact drafts are discarded; storage failure is harmless", () => {
  const h = harness(); const context = data();
  h.records.set("kingpos.publicBookingDraft.salon", JSON.stringify({ version: 2, customer: { email: "old@example.com" } }));
  assert.equal(h.readStoredBookingDraft(context), null);
  assert.equal(h.records.has("kingpos.publicBookingDraft.salon"), false);
  h.writeStoredBookingDraft(context, { ...selection, date: "2001-01-01" });
  const invalidDate = h.readStoredBookingDraft(context);
  assert.equal(invalidDate.date, date); assert.equal(invalidDate.selectedSlotStart, ""); assert.equal(invalidDate.step, 2);
  const key = h.draftStorageKey(context); const stored = JSON.parse(h.records.get(key));
  h.records.set(key, JSON.stringify({ ...stored, savedAt: Date.now() - 2 * 60 * 60 * 1000 - 1 }));
  assert.equal(h.readStoredBookingDraft(context), null); assert.equal(h.records.has(key), false);
  const blocked = harness(true);
  assert.equal(blocked.writeStoredBookingDraft(context, selection), false);
  assert.equal(blocked.readStoredBookingDraft(context), null);
  assert.doesNotThrow(() => blocked.clearStoredBookingDraft(context));
});

test("auth handoff is consumed once and cannot move a signed-in user's draft to another account", () => {
  const h = harness();
  h.writeStoredBookingDraft(data(null), selection, true);
  assert.equal(h.readStoredBookingDraft(data("alice")).notes, selection.notes);
  assert.equal(h.readStoredBookingDraft(data("alice")), null);
  h.writeStoredBookingDraft(data("alice"), selection, true);
  assert.equal(h.readStoredBookingDraft(data("bob")), null);
  assert.equal(h.readStoredBookingDraft(data("alice")).notes, selection.notes);
  h.writeStoredBookingDraft(data(null), selection, true);
  const key = h.draftStorageKey(data(null), true); const stored = JSON.parse(h.records.get(key));
  h.records.set(key, JSON.stringify({ ...stored, savedAt: Date.now() - 15 * 60 * 1000 - 1 }));
  assert.equal(h.readStoredBookingDraft(data("alice")), null);
});

test("session storage is bounded even after visiting many booking intents", () => {
  const h = harness(); const context = data();
  for (let index = 0; index < 30; index++) h.writeStoredBookingDraft({ ...context, initialSelection: { ...context.initialSelection, serviceId: `intent-${index}` } }, selection);
  assert.equal(h.records.size, 20);
});

test("a corrupt auth handoff cannot prevent restoring a valid regular draft", () => {
  const h = harness(), context = data();
  h.writeStoredBookingDraft(context, selection);
  const corruptKey = h.draftStorageKey(context, true);
  h.records.set(corruptKey, "{incomplete");
  assert.equal(h.readStoredBookingDraft(context).notes, selection.notes);
  assert.equal(h.records.has(corruptKey), false);
});

test("mobile booking reload restores choices only after live availability, handles stale slots and clears completed work", {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout: 120000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{PublicBookingClient}from'./app/book/[salonId]/public-booking-client';
    const params=new URLSearchParams(location.search);const date=${JSON.stringify(date)};
    window.calls={slots:[],create:[]};window.hold=params.has('hold');
    const data={state:'ready',message:'',title:'Book',salon:{salonId:'salon',name:'Nails',logoUrl:null,coverUrl:null,city:'Milwaukee',state:'WI',publicProfileEnabled:true},settings:{anyProfessionalEnabled:true,splitStaffAppointmentEnabled:true,guestBookingEnabled:true,confirmationMode:'instant_booking',timezoneIana:'America/Chicago',maximumAdvanceWindowDays:60,minimumLeadTimeMinutes:0,sameDayBookingEnabled:true,slotIntervalMinutes:30},currentUser:{id:params.get('viewer')??'alice',displayName:'Alice Example',firstName:'Alice',lastName:'Example',phone:'4145551234',email:'alice@example.com'},services:[{id:'mani',name:'Manicure',category:'Nails',basePrice:params.has('price')?99:25,durationMinutes:30,addOnIds:[],isAddOnOnly:false}],staff:[{id:'tracy',displayName:'Tracy',avatarUrl:null}],staffByService:{mani:['tracy']},slots:[],initialSelection:{serviceId:'mani',serviceIds:['mani'],staffId:'tracy',staffMode:'specific',date,initialStep:0,source:'explore',inspiration:null,lookId:null,addOnSelections:[],addOnServiceIds:[]}};
    window.makeSlots=selection=>[0,1,2].filter(n=>!params.has('gone')||n!==1).map(n=>{const start=new Date(selection.date+'T15:00:00Z');start.setUTCMinutes(start.getUTCMinutes()+n*60);return{date:selection.date,startAt:start.toISOString(),endAt:new Date(+start+1800000).toISOString(),label:('Time '+n),lines:[{serviceId:'mani',serviceName:'Manicure',staffId:'tracy',staffName:'Tracy',unitPrice:data.services[0].basePrice,durationMinutes:30}]};});
    createRoot(document.getElementById('root')).render(<PublicBookingClient data={data}/>);`;
  const built = await build({ stdin: { resolveDir: process.cwd(), contents: fixture, loader: "tsx" }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "booking-live-fixture", setup(builder) {
    builder.onResolve({ filter: /public-booking-availability-client$|public-booking-submit-client$|next\/navigation$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation" ? "export const useRouter=()=>({replace(){}});" : `export async function loadPublicBookingSlotsAction(input){window.calls.slots.push(input);if(window.hold)await new Promise(resolve=>window.releaseSlots=resolve);return window.makeSlots(input.selection);}export async function loadPublicBookingAvailabilityHintsAction(){return [];}export async function createPublicBookingAction(input){window.calls.create.push(input);return{ok:true,bookingId:'booked',accountLinked:true,message:'Confirmed',confirmationStatus:'confirmed'};}` }));
  } }] });
  const script = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); }
    else response.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.getByTestId("public-booking-next").click();
    await page.getByTestId("public-booking-slot").nth(1).click();
    await page.getByTestId("public-booking-next").click();
    await page.getByText("Add a note (optional)", { exact: true }).click();
    await page.getByLabel("Appointment note").fill("Keep the shape");
    await page.waitForFunction(() => Object.values(sessionStorage).some(value => value.includes('Keep the shape')));
    const before = await page.evaluate(() => Object.values(sessionStorage).join(""));
    assert.doesNotMatch(before, /alice@example|4145551234|Alice Example/);
    await page.goto(url + "?hold&price");
    await page.waitForFunction(() => window.calls.slots.length === 1 && Boolean(window.releaseSlots));
    assert.equal(await page.getByTestId("public-booking-next").isDisabled(), true, "saved slots cannot confirm before a live read");
    await page.evaluate(() => { window.hold = false; window.releaseSlots(); });
    await page.waitForFunction(() => !document.querySelector('[data-testid="public-booking-next"]').disabled);
    await page.getByText("Add a note (optional)", { exact: true }).click();
    assert.equal(await page.getByLabel("Appointment note").inputValue(), "Keep the shape");
    assert.match(await page.getByTestId("public-booking-root").textContent(), /\$99/);
    await page.goto(url + "?gone");
    await page.getByRole("heading", { name: "Choose start time", exact: true }).waitFor();
    await page.getByTestId("public-booking-slot").first().waitFor();
    assert.equal(await page.getByTestId("public-booking-next").isDisabled(), true, "removed saved time requires a fresh choice");
    await page.getByTestId("public-booking-slot").first().click();
    await page.getByTestId("public-booking-next").click();
    await page.getByTestId("public-booking-next").click();
    await page.waitForFunction(() => window.calls.create.length === 1);
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('kingpos.publicBookingDraft.v3.')).length), 0);
    await page.goto(url);
    await page.getByRole("heading", { name: "Choose services", exact: true }).waitFor();
    await page.evaluate(() => { sessionStorage.clear(); window.dispatchEvent(new Event('reylumi:experience-reset')); });
    await page.getByTestId("public-booking-next").click();
    await page.getByTestId("public-booking-slot").first().waitFor();
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('kingpos.publicBookingDraft.v3.')).length), 0, "a reset stops stale mounted components from repopulating account drafts");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
});
