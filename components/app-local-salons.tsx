"use client";
import {WorkspaceText,useWorkspaceTranslation}from"@/components/workspace-language";
import {SubmitButton}from"@/components/submit-button";
import {createSalonAction,setCurrentSalon}from"@/app/salons/actions";
import {CreateSalonSubmitButton}from"@/app/salons/create-salon-submit-button";
import {useEffect,useRef,useState,useTransition,type ReactNode}from"react";
import {findBusinessClaimMatches}from"@/lib/business-claim-client";
import type{BusinessClaimInput,BusinessClaimMatch}from"@/lib/business-claims";
import {QueryErrorDialog}from"@/app/query-error-dialog";
import {routes}from"@/lib/routes";
import type{Location}from"@/types/location";
import type{AppLocalSalonsData}from"@/lib/app-local-business-metadata";
import Link from"next/link";
type SalonManagementSearchParams=Record<string,string|string[]|undefined>;
// These are UI drafts, never submitted operations. Clear only this namespace on account reset.
function clearSalonDrafts() {
  try { for (let index=sessionStorage.length-1;index>=0;index--) { const key=sessionStorage.key(index);if(key?.startsWith("reylumi:salon-create:"))sessionStorage.removeItem(key); } } catch { /* Storage is optional. */ }
}
if(typeof window!=="undefined")for(const event of ["reylumi:experience-reset","reylumi:app-local-reset","reylumi:offline-clear"])window.addEventListener(event,clearSalonDrafts);
function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAddress(salon: Location) {
  const cityStateZip = [salon.city, salon.state, salon.postal_code]
    .filter(Boolean)
    .join(", ");
  const lines = [
    salon.address_line1,
    salon.address_line2,
    cityStateZip,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join(", ") : null;
}

function InputField({
  autoComplete,
  label,
  name,
  required = false,
  defaultValue,
}: {
  autoComplete?: string;
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700"><WorkspaceText text={label} /></span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        name={name}
        defaultValue={defaultValue}
        required={required}
        type="text"
      />
    </label>
  );
}

function SalonForm({ createRequestKey, draft, draftKey }: { createRequestKey: string; draft: SalonManagementSearchParams; draftKey:string }) {
  const value = (key: string) => firstSearchParam(draft[key]);
  return (
    <ClaimSuggestions draftKey={draftKey}>
    <form
      action={createSalonAction}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      <input name="create_request_key" type="hidden" value={createRequestKey} />
      <input name="duplicate_acknowledged" type="hidden" defaultValue="no" />
      <div className="sm:col-span-2">
        <InputField
          autoComplete="Account"
          label="Salon name"
          name="name"
          required
          defaultValue={value('name')}
        />
      </div>
      <InputField autoComplete="tel" label="Phone" name="phone" defaultValue={value('phone')} />
      <InputField
        autoComplete="address-line1"
        label="Address line 1"
        name="address_line1"
        defaultValue={value('address_line1')}
      />
      <InputField
        autoComplete="address-line2"
        label="Address line 2"
        name="address_line2"
        defaultValue={value('address_line2')}
      />
      <InputField autoComplete="address-level2" label="City" name="city" defaultValue={value('city')} />
      <InputField autoComplete="address-level1" label="State" name="state" defaultValue={value('state')} />
      <InputField
        autoComplete="postal-code"
        label="Zip code"
        name="postal_code"
        defaultValue={value('postal_code')}
      />

      <label className="flex items-start gap-3 rounded-md border border-zinc-200 p-4 sm:col-span-2">
        <input type="checkbox" name="owner_is_staff" value="yes" defaultChecked={value("owner_is_staff") === "yes"} className="mt-1" />
        <span><span className="block text-sm font-medium"><WorkspaceText text="I also work as staff at this salon" /></span>
          <span className="mt-1 block text-sm text-zinc-600"><WorkspaceText text="Create my staff profile using my personal name, email, and phone. I will keep my Owner access." /></span>
        </span>
      </label>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <CreateSalonSubmitButton />
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href={routes.salons.list()}
        >
          <WorkspaceText text="Cancel" />
        </Link>
      </div>
    </form>
    </ClaimSuggestions>
  );
}

function SalonCreationUnavailable({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-sm font-semibold text-amber-950"><WorkspaceText text={title} /></h2>
      <p className="mt-2 text-sm text-amber-900">{description}</p>
      <Link
        className="mt-4 inline-flex rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        href={routes.salons.list()}
      >
        <WorkspaceText text="Back to Salons" />
      </Link>
    </div>
  );
}

function SalonList({
  canSwitchSalon,
  currentSalonId,
  salons,
  showCreateAction,
}: {
  canSwitchSalon: boolean;
  currentSalonId: string | null;
  salons: Location[];
  showCreateAction: boolean;
}) {
  if (salons.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="No salons yet" /></h2>
        <p className="mt-2 text-sm text-zinc-600">
          <WorkspaceText text="Create your first salon so customers, services, tickets, and bookings have a home." />
        </p>
        {showCreateAction ? (
          <Link
            className="mt-4 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href={routes.salons.create()}
          >
            <WorkspaceText text="Create your first Salon" />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3"><WorkspaceText text="Salon" /></div>
        <div className="hidden sm:col-span-3 sm:block"><WorkspaceText text="Address" /></div>
        <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Phone" /></div>
        <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Status" /></div>
        <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Current" /></div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {salons.map((salon) => {
          const address = formatAddress(salon);
          const isCurrentSalon = salon.id === currentSalonId;

          return (
            <li className="grid grid-cols-12 gap-3 px-5 py-4" key={salon.id}>
              <div className="col-span-12 sm:col-span-3">
                <p className="font-medium text-zinc-950"><a href={`/settings?section=salon-${encodeURIComponent(salon.id)}-salon-profile`} className="hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange">{salon.name}</a></p>
                {isCurrentSalon ? (
                  <span className="mt-2 inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white">
                    <WorkspaceText text="Current Salon" />
                  </span>
                ) : null}
              </div>
              <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-3">
                <span className="font-medium text-zinc-500 sm:hidden"><WorkspaceText text="Address:" /> </span>
                <WorkspaceText text={address || "No address"} />
              </div>
              <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
                <span className="font-medium text-zinc-500 sm:hidden"><WorkspaceText text="Phone:" /> </span>
                {salon.phone || "-"}
              </div>
              <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
                <span className="font-medium text-zinc-500"><WorkspaceText text="Salon status:" /> </span>
                <WorkspaceText text={formatLabel(salon.status)} />
              </div>
              <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-2">
                {isCurrentSalon ? (
                  <span className="font-medium text-zinc-950"><WorkspaceText text="Selected" /></span>
                ) : canSwitchSalon ? (
                  <form action={setCurrentSalon}>
                    <input name="salon_id" type="hidden" value={salon.id} />
                    <SubmitButton pendingLabel="Processing…"
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                      type="submit"
                    >
                      <WorkspaceText text="Set as Current" />
                    </SubmitButton>
                  </form>
                ) : (
                  <span>-</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


export function AppLocalSalons({data,scope,mode="list",query={}}:{data:AppLocalSalonsData;scope:string;mode?:"list"|"create";query?:SalonManagementSearchParams}){const __vt=useWorkspaceTranslation();const [requestKey]=useState(data.createRequestKey);const draftKey="reylumi:salon-create:"+scope;const errorMessage=firstSearchParam(query.error),createdMessage=firstSearchParam(query.created)==="1"?"Salon created successfully.":null;const {salons,hasCreatePermission}=data;
  if (mode === "create") {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <QueryErrorDialog
          message={errorMessage}
          primaryLabel="Review form"
          secondaryHref={routes.salons.list()}
          secondaryLabel="Salons"
          title={__vt("Salon action needed")}
        />

        {hasCreatePermission ? (
          <SalonForm createRequestKey={requestKey} draft={query} draftKey={draftKey} />
        ) : (
          <SalonCreationUnavailable
            description={__vt("You do not have permission to create a salon.")}
            title={__vt("Create Salon is unavailable")}
          />
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap justify-end gap-3">
        <div className="flex flex-wrap gap-3">
          {hasCreatePermission ? (
            <Link
              aria-label={__vt("Create Salon")}
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              href={routes.salons.create()}
            >
              <WorkspaceText text="Create Salon" />
            </Link>
          ) : null}
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/account"
          >
            <WorkspaceText text="Account" />
          </Link>
        </div>
      </div>

      <QueryErrorDialog
        message={errorMessage}
        primaryLabel="Review salons"
        secondaryHref="/my-place"
        secondaryLabel="My Place"
        title={__vt("Salon action needed")}
      />
      {createdMessage ? (
        <><ClearSalonCreationDraft draftKey={draftKey} /><p className="mt-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {createdMessage}
        </p></>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Your Salons" /></h2>
        <SalonList
          canSwitchSalon={true}
          currentSalonId={data.currentSalonId}
          salons={salons}
          showCreateAction={hasCreatePermission}
        />
      </section>
    </main>
  );
}

// Scoped copy of the original duplicate-check/draft behavior.
function readForm(form:HTMLFormElement):BusinessClaimInput {
 const data=new FormData(form);const text=(key:string)=>String(data.get(key)??'');
 return {name:text('name'),phone:text('phone'),address:text('address_line1'),unit:text('address_line2'),city:text('city'),state:text('state')};
}
function ClearSalonCreationDraft({draftKey}:{draftKey:string}) {
 useEffect(()=>{try{sessionStorage.removeItem(draftKey);}catch{}},[draftKey]);
 return null;
}
const inputKey=(input:BusinessClaimInput)=>JSON.stringify(input);
function ClaimSuggestions({children,draftKey}:{children:ReactNode;draftKey:string}) {
 const wrapper=useRef<HTMLDivElement>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const generation=useRef(0);
 const [matches,setMatches]=useState<BusinessClaimMatch[]>([]);const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 const checkedKey=useRef('');const acknowledgedKey=useRef('');
 const activeSearch=useRef<AbortController|null>(null);
 useEffect(()=>{
 const form=wrapper.current?.querySelector('form');if(!form)return;
 try {const draft=JSON.parse(sessionStorage.getItem(draftKey)??'null') as Record<string,string>|null;
 if(draft)for(const [key,value] of Object.entries(draft)){const field=form.elements.namedItem(key);if(field instanceof HTMLInputElement && field.type!=='hidden'){if(field.type==='checkbox')field.checked=value==='yes';else if(!field.value)field.value=value;}}
 }catch{/* Browser storage is optional. */}
 return ()=>{if(timer.current)clearTimeout(timer.current);activeSearch.current?.abort();activeSearch.current=null;};
 },[draftKey]);
 async function search(form:HTMLFormElement) {
 const input=readForm(form),key=inputKey(input),current=++generation.current;
 activeSearch.current?.abort();const controller=new AbortController();activeSearch.current=controller;
 const deadline=setTimeout(()=>controller.abort(),12000);
 let result;
 try{result=await findBusinessClaimMatches(input,controller.signal);}finally{clearTimeout(deadline);}
 if(activeSearch.current!==controller || current!==generation.current || key!==inputKey(readForm(form)))return null;
 checkedKey.current=result.error?'':key;setMatches(result.matches);setError(result.error);
 return result;
 }
 function persist(form:HTMLFormElement) {
 const data=new FormData(form);const draft:Record<string,string>={};for(const [key,value] of data)if(typeof value==='string' && key!=='create_request_key' && key!=='duplicate_acknowledged')draft[key]=value;
 try{sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{}
 }
 function continueCreate() {
 const form=wrapper.current?.querySelector('form');if(!form)return;
 acknowledgedKey.current=inputKey(readForm(form));
 const field=form.elements.namedItem('duplicate_acknowledged');if(field instanceof HTMLInputElement)field.value='yes';
 form.requestSubmit();
 }
 return <div ref={wrapper} onChange={event=>{
 const form=(event.target as HTMLInputElement).form;if(!form)return;
 persist(form);acknowledgedKey.current='';generation.current++;activeSearch.current?.abort();setMatches([]);setError(null);
 const field=form.elements.namedItem('duplicate_acknowledged');if(field instanceof HTMLInputElement)field.value='no';
 if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>startTransition(async()=>{await search(form);}),450);
 }} onSubmit={event=>{
 const form=event.target as HTMLFormElement;if(!(form instanceof HTMLFormElement))return;
 const key=inputKey(readForm(form));persist(form);
 if(acknowledgedKey.current===key || checkedKey.current===key && matches.length===0)return;
 event.preventDefault();if(timer.current)clearTimeout(timer.current);
 startTransition(async()=>{const result=await search(form);if(result && !result.error && result.matches.length===0)form.requestSubmit();});
 }}>
 {children}
 <div aria-live="polite" className="mt-4">
 {pending?<p className="text-sm text-zinc-500"><WorkspaceText text="Checking existing salons…" /></p>:null}
 {error?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /></p>:null}
 {matches.length?<section className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold"><WorkspaceText text="Your salon may already be on Reylumi" /></h2><p className="text-sm text-zinc-600"><WorkspaceText text="Choose an existing profile to keep its followers and posts." /></p>{matches.map(row=><article key={row.salon_id} className="rounded-xl bg-white p-3"><h3 className="font-semibold">{row.name}</h3><p className="text-sm text-zinc-600">{row.address}</p><p className="text-sm text-zinc-600">{row.phone}</p><p className="mt-1 text-xs text-zinc-500"><WorkspaceText text={row.phone_match && row.address_match?'Same phone and address':row.phone_match?'Same phone':row.address_match?'Similar address':'Similar name'} /></p><Link className="mt-2 inline-block rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white" href={`/claim/${row.salon_id}`}><WorkspaceText text={row.unclaimed?'This is my salon — claim it':'This is my salon — request access'} /></Link></article>)}<button type="button" disabled={pending} className="justify-self-start text-sm underline" onClick={continueCreate}><WorkspaceText text="My salon is different — continue creating" /></button></section>:null}
 </div></div>;
}
