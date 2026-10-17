import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const salonId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-12T20:00:00.000Z";
class BookingDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}

function compile(source, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] ?? {}, Date: BookingDate, Intl, console });
  return exports;
}

// Keep real timezone conversion and slot generation; only external data is mocked.
const dates = ts.createSourceFile("bookings.ts", readFileSync("lib/bookings.ts", "utf8"), ts.ScriptTarget.Latest, true);
const dateNames = ["isIsoDate", "pad", "timeZoneParts", "timeZoneOffsetMs", "zonedDateTimeToUtcIso", "formatDateInTimeZone"];
const dateSource = dates.statements.filter(node => ts.isFunctionDeclaration(node) && dateNames.includes(node.name?.text)).map(node => node.getText(dates)).join("\n");
const dateFunctions = compile(dateSource);

function fixture() {
  return {
    state: "ready",
    profile: { salon_id: salonId, name: "Test salon", public_discovery_enabled: true },
    settings: { booking_enabled: true, online_booking_visible: true, guest_booking_enabled: true,
      any_professional_enabled: false, timezone_iana: "America/Chicago", maximum_advance_window_days: 14,
      minimum_lead_time_minutes: 120, same_day_booking_enabled: false, slot_interval_minutes: 15 },
    services: [{ id: serviceId, name: "Full Set", duration_minutes: 45, base_price: 40 }],
    staff: [{ id: staffId, display_name: "Professional" }],
    assignments: [{ service_id: serviceId, staff_id: staffId, custom_duration_minutes: null, custom_price: null }],
    availability_rules: [1, 2, 3, 4, 5, 6].map(day => ({ staff_id: staffId, day_of_week: day, rule_type: "working", starts_at_local: "09:00:00", ends_at_local: "17:00:00" })),
    add_on_links: [], looks: [], busy_lines: [], time_blocks: [],
  };
}

const gelId='44444444-4444-4444-8444-444444444444',frenchId='55555555-5555-4555-8555-555555555555',massageId='66666666-6666-4666-8666-666666666666';
function extrasFixture() {
  const c=fixture();c.settings.slot_interval_minutes=5;c.settings.minimum_lead_time_minutes=0;
  for (const [id,name,group,duration,price] of [[gelId,'Gel','one',15,15],[frenchId,'French','one',10,10],[massageId,'Massage','many',10,10]]) {
    c.services.push({id,name,booking_parent_service_id:serviceId,booking_add_on_group:group,duration_minutes:duration,base_price:price});
    c.add_on_links.push({parent_service_id:serviceId,add_on_service_id:id});
    c.assignments.push({service_id:id,staff_id:staffId,custom_duration_minutes:null,custom_price:null});
  }
  return c;
}
const selection={date:'2026-10-13',serviceId,staffId,staffMode:'specific',addOnSelections:[gelId,massageId].map(serviceId=>({parentServiceId:selectionParent(),serviceId}))};
function selectionParent(){return serviceId;}
const load=(c,chosen=selection)=>loader(c).loadPublicBookingSlots({salonId,selection:chosen});
const atNine=slots=>slots.find(slot=>slot.startAt==='2026-10-13T14:00:00.000Z');

test('owned add-ons remain outside main booking menu and both groups contribute price/time',async()=>{
  const c=extrasFixture(),api=loader(c);
  const page=await api.getPublicBookingPageData(salonId,{});
  assert.equal(page.services.find(item=>item.id===gelId).isAddOnOnly,true);
  assert.equal(page.services.find(item=>item.id===gelId).addOnGroup,'one');
  const slot=atNine(await load(c));assert.ok(slot);
  assert.equal(slot.lines.length,3);
  assert.equal(slot.lines.reduce((sum,line)=>sum+line.unitPrice,0),65);
  assert.equal(slot.lines.reduce((sum,line)=>sum+line.durationMinutes,0),70);
  assert.equal(slot.endAt,'2026-10-13T15:10:00.000Z');
  assert.equal((await load(c,{...selection,serviceId:gelId,addOnSelections:[]})).length,0,'extra cannot be booked as main service');
});

test('single-choice rejects two extras while optional empty selections preserve original booking',async()=>{
  const c=extrasFixture();
  await assert.rejects(load(c,{...selection,addOnSelections:[gelId,frenchId].map(serviceId=>({parentServiceId:selectionParent(),serviceId}))}),/at most one/);
  const slot=atNine(await load(c,{...selection,addOnSelections:[]}));
  assert.equal(slot.lines.length,1);assert.equal(slot.lines[0].unitPrice,40);assert.equal(slot.endAt,'2026-10-13T14:45:00.000Z');
});

test('staff override and existing per-line buffers determine actual next bookable time',async()=>{
  const c=extrasFixture();c.settings.default_cleanup_buffer_minutes=5;
  c.assignments[0].custom_duration_minutes=50;c.assignments[0].custom_price=42;
  c.assignments.find(a=>a.service_id===gelId).custom_duration_minutes=20;
  c.assignments.find(a=>a.service_id===gelId).custom_price=18;
  const slot=atNine(await load(c));assert.ok(slot);
  assert.equal(slot.lines.reduce((sum,line)=>sum+line.unitPrice,0),70);
  assert.equal(slot.endAt,'2026-10-13T15:35:00.000Z','80 service minutes + three existing 5-minute buffers');
  c.busy_lines=slot.lines.map(line=>({booking_id:'77777777-7777-4777-8777-777777777777',staff_id:line.staffId,scheduled_start_at:line.startAt,scheduled_end_at:line.endAt}));
  const next=await load(c,{...selection,addOnSelections:[]});
  assert.equal(next[0].startAt,slot.endAt,'same staff can receive next booking at exact occupied end');
  assert.ok(!next.some(candidate=>candidate.startAt==='2026-10-13T15:30:00.000Z'),'cannot book before extra time and buffer finish');
});

test('extras invalidate slots crossing next appointment, breaks or closing time',async()=>{
  for(const kind of ['next','break','close']) {
    const c=extrasFixture();
    if(kind==='next')c.busy_lines=[{booking_id:'77777777-7777-4777-8777-777777777777',staff_id:staffId,scheduled_start_at:'2026-10-13T15:00:00Z',scheduled_end_at:'2026-10-13T15:30:00Z'}];
    if(kind==='break')c.availability_rules.push({staff_id:staffId,day_of_week:2,rule_type:'break',starts_at_local:'10:00:00',ends_at_local:'10:30:00'});
    if(kind==='close')c.availability_rules.forEach(rule=>rule.ends_at_local='10:00:00');
    assert.ok(atNine(await load(c,{...selection,addOnSelections:[]})),kind+' permits base service');
    assert.equal(atNine(await load(c)),undefined,kind+' blocks extra duration');
  }
});

test('split staff retain their own occupied end instead of blocking every staff for the whole appointment',async()=>{
  const c=extrasFixture(),secondStaff='88888888-8888-4888-8888-888888888888';
  c.settings.split_staff_appointment_enabled=true;
  c.staff.push({id:secondStaff,display_name:'Second professional'});
  c.availability_rules.push(...c.availability_rules.map(rule=>({...rule,staff_id:secondStaff})));
  c.assignments.find(item=>item.service_id===massageId).staff_id=secondStaff;
  const slot=atNine(await load(c,{...selection,staffMode:'split',lineStaffIds:[staffId,staffId,secondStaff]}));
  assert.ok(slot);assert.equal(slot.lines[2].staffId,secondStaff);
  assert.equal(slot.endAt,'2026-10-13T15:10:00.000Z');
  c.busy_lines=slot.lines.map(line=>({booking_id:'77777777-7777-4777-8777-777777777777',staff_id:line.staffId,scheduled_start_at:line.startAt,scheduled_end_at:line.endAt}));
  const next=await load(c,{...selection,addOnSelections:[]});
  assert.equal(next[0].startAt,'2026-10-13T15:00:00.000Z','first staff is free once their own service and gel lines finish');
});

function loader(context) {
  return compile(readFileSync("lib/public-booking.ts", "utf8"), {
    "@/lib/bookings": dateFunctions,
    "@/lib/supabase/server": {
      createSupabaseServerClient: () => ({ rpc: async name => ({ data: name === "get_public_booking_context" ? context : null, error: null }) }),
      createAuthenticatedSupabaseServerClient: async () => null,
    },
    "@/lib/content-booking": { loadPublicContentBookingOptions: async () => [] },
    "@/lib/booking-deposit": { publicBookingDeposit: async () => null },
    "@/lib/salon-profile": { getSalonProfileMediaUrl: () => null },
    "@/lib/staff-profile": { getStaffProfileAvatarUrl: () => null },
  });
}



