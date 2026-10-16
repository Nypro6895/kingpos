import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("POS, attendance, booking and staff actions acknowledge delayed operations without duplicate writes", { skip: !existsSync(executablePath), timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{PortableCheckInClient}from'./app/pos/portable/check-in/portable-check-in-client';
      import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';
      import{StaffBookingSettings}from'./app/staff/appointments/staff-booking-settings-client';
      import{StaffConfirmBookingButton}from'./app/staff/appointments/staff-confirm-booking-button';
      import{OwnerPosClient}from'./app/pos/owner-pos-client';
      import{PortableDraftControls}from'./app/pos/portable/portable-draft-controls';
      window.calls=[];window.pending=[];window.refreshes=0;
      window.delayed=(name,input)=>{window.calls.push({name,input});return new Promise((resolve,reject)=>window.pending.push({name,resolve,reject,settled:false}))};
      window.finish=(name,result)=>{const row=window.pending.find(item=>item.name===name&&!item.settled);if(!row)throw Error('No pending '+name);row.settled=true;row.resolve(result)};
      window.fail=name=>{const row=window.pending.find(item=>item.name===name&&!item.settled);if(!row)throw Error('No pending '+name);row.settled=true;row.reject(Error('Fixture unavailable'))};
      window.fetch=async(url,options={})=>{
        const body=options.body?JSON.parse(options.body):{};
        if(url==='/api/staff/booking-preferences')return new Response(JSON.stringify(body.preference?await window.delayed('preference',body):{ok:true,online:true,notifications:true}),{status:200});
        if(url==='/api/staff/confirm-booking')return new Response(JSON.stringify(await window.delayed('staff-confirm',body)),{status:200});
        return new Response('{}',{status:503});
      };
      const today=new Date().toISOString().slice(0,10),start=today+'T12:00:00.000Z';
      const appointment={id:'booking-1',customerId:'customer-1',customerName:'Fixture Customer',customerPhone:'',customerEmail:'',serviceIds:['service-1'],serviceNames:['Fixture Service'],staffId:null,staffName:null,startAt:start,endAt:today+'T12:30:00.000Z',status:'pending',updatedAt:start,lines:[]};
      const bookData={date:today,timezone:'UTC',salonName:'Fixture Salon',appointments:[appointment],canCreate:true,canCancel:true,canCreateTicket:true,setupMessage:null,services:[{id:'service-1',name:'Fixture Service',base_price:20,duration_minutes:30,category:'Service'}],staff:[]};
      const staff={id:'staff-1',displayName:'Fixture Staff',jobTitle:null,avatarUrl:null,checkInAt:null,checkInSequence:null,queueTurnCount:0,status:'not_checked_in',isPasscodeDefault:false};
      window.appointment=appointment;
      function Park(){const[active,setActive]=useState(true);return <PortableDraftControls scope='fixture-park' active={active} activity='draft' value={{amount:'35'}} label='Fixture draft' reset={async()=>{await window.delayed('park-reset',JSON.parse(localStorage.getItem('kingpos:parked-tickets:v1:fixture-park')));setActive(false)}} restore={()=>true}/>}
      function App(){const screen=new URLSearchParams(location.search).get('screen');
        if(screen==='checkin')return <PortableCheckInClient action={input=>window.delayed('attendance-action',input)} data={{salonId:'salon-1',salonLogoUrl:null,salonName:'Fixture Salon',timezone:'UTC',today,staff:[staff],checkInEnabled:true}}/>;
        if(screen==='book')return <PortableBookWorkspace data={bookData} action={input=>window.delayed('create-booking',input)} manageAction={input=>window.delayed('booking-'+input.action,input)}/>;
        if(screen==='staff')return <><StaffConfirmBookingButton bookingId='booking-1'/><StaffBookingSettings salonId='salon-1' staff={{id:'staff-1',displayName:'Fixture Staff',jobTitle:null,onlineBookingEnabled:true}} assignedServices={[]} availabilityRules={[]} salonBookingStatus={{onlineBookingOpen:true}} timezone='UTC' timeBlocks={[{id:'block-1',staff_id:'staff-1',block_type:'time_off',is_active:true,starts_at:'2099-12-01T00:00:00Z',ends_at:'2099-12-02T00:00:00Z',reason:'Fixture time off'}]}/></>;
        if(screen==='pos')return <OwnerPosClient scope='fixture-owner' salonId='salon-1' salonName='Fixture Salon' initial={{staff:[],services:[],today,defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>;
        return <Park/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "delayed-action-fixture", setup(builder) {
      const fixture = {
        "next/navigation": `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({refresh(){window.refreshes++}});`,
        "next/link": `export default function Link({prefetch,...props}){return <a {...props}/>}`,
        "next/image": `export default function Image({fill,priority,...props}){return <img {...props}/>}`,
        "@/components/workspace-language": `export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return value=>value}`,
        "@/lib/pos-workspace-sync": `export const subscribePosChanges=()=>()=>{};export function usePosResourceRefresh(){}`,
        "@/lib/supabase/browser": `export const createSupabaseBrowserClient=()=>null;`,
        "@/lib/portable-offline-staff": `export async function prepareOfflineStaff(){}export function verifyAndSealStaffPasscode(scope,id,passcode){return window.delayed('seal',{scope,id,passcode})}`,
        "@/app/pos/portable/portable-workspace-state": `export function usePortableWorkspaceState(){return new URLSearchParams(location.search).get('offline')==='1'?{scope:'fixture-offline',offlineEnabled:true,businessDate:new Date().toISOString().slice(0,10),attendanceByStaffId:{},setAttendance(){}}:null}`,
        "@/lib/portable-operations": `export const PORTABLE_OPERATIONS_CHANGED='fixture:changed';export async function listPortableOperations(){return []}export async function portableCheckpoint(){return 0}export function savePortableOperation(scope,kind,input){return window.delayed('operation-'+kind,{scope,input})}`,
        "@/app/booking-setup/actions": `export const createStaffTimeBlockAction=input=>window.delayed('timeoff-create',input);export const cancelStaffTimeBlockAction=input=>window.delayed('timeoff-cancel',input);export const saveStaffWeeklyAvailabilityAction=input=>window.delayed('hours-save',input);`,
        "./staff-schedule-interactions": `export const useStaffConfirmation=()=>null;`,
        "./booking-views": `export function BookingViews({actions,appointments}){return <button onClick={()=>actions.status(appointments[0])}>Manage fixture appointment</button>}`,
        "@/components/booking-ui/no-show-confirmation": `export async function confirmNoShowHistory(){throw Error('No override confirmation in this fixture')}`,
        "./time-off-range-picker": `export function TimeOffRangePicker(){return null}`,
        "@/app/service-relay/desk-relay": `export function DeskRelay(){return null}`,
        "./single-workspace-window": `export function SingleWorkspaceWindow({children}){return children}`,
        "./owner-pos-tabs": `export function OwnerPosTabs(){return null}`,
        "./portable/portable-sync-indicator": `export function PortableSyncIndicator(){return null}`,
        "./actions": `export async function searchPosDeskCustomers(){return []}`,
      };
      builder.onResolve({ filter: /./ }, args => args.path in fixture ? { path: args.path, namespace: "fixture" } : args.path.endsWith(".css") ? { path: args.path, namespace: "css-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: fixture[args.path] }));
      builder.onLoad({ filter: /.*/, namespace: "css-fixture" }, () => ({ loader: "js", contents: "export default new Proxy({},{get:(_,key)=>String(key)})" }));
    }}],
  });
  const css = readFileSync("app/staff/appointments/staff-appointments.css", "utf8") + readFileSync("app/pos/portable/book/booking.module.css", "utf8") + readFileSync("app/pos/owner-pos.css", "utf8");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}button,input{min-height:32px}em{font-style:normal}' + css + '</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const visit = screen => page.goto(`http://127.0.0.1:${server.address().port}/pos/portable/check-in?screen=${screen}`);
  const calls = name => page.evaluate(name => window.calls.filter(row => row.name === name).length, name);
  const finish = (name, result) => page.evaluate(({ name, result }) => window.finish(name, result), { name, result });
  const busy = async (button, text) => { await button.filter({ hasText: text }).waitFor(); assert.equal(await button.getAttribute("aria-busy"), "true"); assert.equal(await button.isDisabled(), true); assert.equal(await button.locator('.animate-spin[aria-hidden="true"]').count(), 1); };
  try {
    await visit("checkin&offline=1");
    await page.getByRole("button", { name: /Fixture Staff/ }).click();
    for (const digit of ["1", "2", "3", "4"]) await page.getByRole("button", { name: digit, exact: true }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /Confirm|Saving/ });
    await confirm.click(); await busy(confirm, "Saving");
    await confirm.evaluate(button => { button.click(); button.click(); });
    assert.equal(await calls("seal"), 1, "repeated input cannot duplicate passcode sealing or attendance");
    await finish("seal", "sealed-fixture");
    await page.waitForFunction(() => window.calls.some(row => row.name === "operation-attendance"));
    await busy(confirm, "Saving");
    await finish("operation-attendance", {});
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await calls("operation-attendance"), 1);

    await visit("checkin");
    await page.getByRole("button", { name: /Fixture Staff/ }).click();
    for (const digit of ["1", "2", "3", "4"]) await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    const staffRow = page.getByRole("button", { name: /Fixture Staff/ });
    await busy(staffRow, "Saving");
    await finish("attendance-action", { ok: false, error: "Fixture attendance rejected" });
    await page.getByText("Could not save Fixture Staff", { exact: true }).waitFor();
    assert.equal(await staffRow.isDisabled(), false);

    await visit("book");
    await page.getByRole("button", { name: "Manage fixture appointment" }).click();
    await page.getByRole("status").filter({ hasText: "Opening appointment" }).waitFor();
    await finish("booking-read", { ok: true, data: await page.evaluate(() => window.appointment) });
    const bookingConfirm = page.getByRole("button", { name: /Confirm appointment|Confirming/ });
    await bookingConfirm.click(); await busy(bookingConfirm, "Confirming");
    assert.equal(await page.getByRole("button", { name: "Cancel appointment", exact: true }).getAttribute("aria-busy"), "false", "only the chosen status action claims pending");
    await finish("booking-confirm", { ok: false, error: "Fixture booking rejected" });
    await page.getByRole("alert").filter({ hasText: "Fixture booking rejected" }).waitFor();
    assert.equal(await bookingConfirm.isDisabled(), false);
    assert.equal(await calls("booking-confirm"), 1);

    await visit("staff");
    const staffConfirm = page.getByRole("button", { name: /^(Confirm|Confirming…|Confirmed)$/ });
    await staffConfirm.click(); await busy(staffConfirm, "Confirming");
    await finish("staff-confirm", { ok: true });
    await page.getByRole("button", { name: "Confirmed", exact: true }).waitFor();
    await page.getByRole("button", { name: "Booking settings", exact: true }).click();
    const online = page.getByRole("switch", { name: "Online booking", exact: true });
    await online.waitFor(); await online.click(); await busy(online, "Saving");
    const notifications = page.getByRole("switch", { name: "Booking notifications", exact: true });
    assert.equal(await notifications.getAttribute("aria-busy"), "false");
    await finish("preference", { ok: false, error: "Fixture preference rejected" });
    await page.getByRole("alert").filter({ hasText: "Fixture preference rejected" }).waitFor();
    assert.equal(await online.isDisabled(), false);
    const remove = page.getByRole("button", { name: /^(Remove|Removing…)$/ });
    await remove.click(); await busy(remove, "Removing");
    await finish("timeoff-cancel", { ok: false, error: "Fixture removal rejected" });
    await page.getByText("Fixture removal rejected").waitFor();
    assert.equal(await remove.isDisabled(), false);
    await page.getByRole("button", { name: "+ Add more time off", exact: true }).click();
    const add = page.getByRole("button", { name: /^(Add time off|Saving…)$/ });
    await add.click(); await busy(add, "Saving");
    await finish("timeoff-create", { ok: false, error: "Fixture time off rejected" });
    await page.getByText("Fixture time off rejected").waitFor();
    assert.equal(await add.isDisabled(), false);

    await visit("pos");
    await page.locator('input[aria-label="Amount"]:visible').last().fill("35");
    const submit = page.getByRole("button", { name: /^(Submit|Saving…)$/ });
    await submit.click(); await busy(submit, "Saving");
    assert.equal(await page.locator('input[aria-label="Amount"]:visible').last().inputValue(), "35", "working amount remains until the receipt is saved");
    await finish("operation-receipt", {});
    await page.getByRole("button", { name: "Submit", exact: true }).waitFor();
    assert.equal(await calls("operation-receipt"), 1);

    await visit("park");
    const park = page.getByRole("button", { name: /^(Save for later|Saving…)$/ });
    await park.click(); await busy(park, "Saving");
    await park.evaluate(button => { button.click(); button.click(); });
    assert.equal(await calls("park-reset"), 1);
    const parked = await page.evaluate(() => JSON.parse(localStorage.getItem("kingpos:parked-tickets:v1:fixture-park")));
    assert.equal(parked.length, 1, "a second click cannot save the same ticket twice");
    assert.deepEqual(parked[0].value, { amount: "35" }, "draft persists before reset starts");
    await page.evaluate(() => window.fail("park-reset"));
    await page.getByRole("alert").filter({ hasText: "current ticket could not be reset" }).waitFor();
    assert.equal(await park.isDisabled(), false);
    assert.equal(await calls("park-reset"), 1, "a failure never automatically replays reset");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
