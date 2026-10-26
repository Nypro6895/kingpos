"use client";

import { WorkspaceText } from "@/components/workspace-language";
import type { CustomerDisplayPhoneResult } from "@/app/pos/actions";
import type { CustomerVisitRequestedService } from "@/types/customer-visit";
import type { CustomerIdentityChoice } from "@/types/customer-identity";

type CheckIn = Extract<CustomerDisplayPhoneResult, { mode: "check_in" }>;
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const total = (services: CustomerVisitRequestedService[]) => services.reduce((sum, item) => sum + Number(item.basePrice || 0), 0);

export function AccountSelectionPanel({ candidates, disabled, onChoose, onBack }: {
  candidates: CustomerIdentityChoice[]; disabled?: boolean; onChoose: (id: string | null) => void; onBack?: () => void;
}) {
  if (!candidates.length) return null;
  return <section className="grid gap-4 rounded-2xl bg-white p-5" aria-label="Choose your account">
    <h2 className="text-3xl font-semibold"><WorkspaceText text="Choose your account" /></h2>
    {onBack ? <button type="button" disabled={disabled} onClick={onBack} className="min-h-11 justify-self-end rounded-xl border px-4"><WorkspaceText text="Back" /></button> : null}
    {candidates.map(candidate => <button type="button" disabled={disabled} key={candidate.id} onClick={() => onChoose(candidate.id)}
      className="min-h-16 rounded-xl border border-stone-200 p-4 text-left text-xl font-semibold">{candidate.label}<span className="ml-3 text-sm font-normal text-zinc-500">{candidate.phoneHint}</span></button>)}
  </section>;
}

export function CheckInConfirmationPanel({ checkIn }: { checkIn: CheckIn }) {
  const services = checkIn.visit.requestedServices;
  return <section className="grid min-h-0 content-center gap-4 overflow-y-auto bg-stone-50/95 p-5 text-center" data-customer-display-checkin>
    <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-teal-700 text-3xl text-white" aria-hidden="true">✓</div>
    <div><h2 className="text-3xl font-semibold text-zinc-950"><WorkspaceText text="You're checked in!" /></h2>
      <p className="mt-2 text-2xl font-semibold text-zinc-800">{(checkIn.visit.firstName || "Guest").toUpperCase()}</p></div>
    <div className="mx-auto grid w-full max-w-md gap-2 rounded-2xl bg-white p-4 text-left" aria-label="Your selected services">
      {services.map(item => <div className="flex justify-between gap-4 text-base" key={item.id}><span>{item.name}</span><span>{money(item.basePrice)}</span></div>)}
      {!!services.length && <div className="mt-2 flex justify-between gap-4 border-t border-stone-200 pt-3 font-semibold"><WorkspaceText text="Estimated total" /><span>{money(total(services))}</span></div>}
    </div>
    <p className="mx-auto max-w-md text-xl leading-8 text-zinc-700"><WorkspaceText text="Please have a seat. Our team will guide you when it's your turn." /></p>
  </section>;
}

export function ServiceSelectionPanel({ checkIn, disabled, onBack, onSubmit, selectedServiceIds, services, toggleService }: {
  checkIn: CheckIn; disabled: boolean; onBack: () => void; onSubmit: () => void;
  selectedServiceIds: string[]; services: CustomerVisitRequestedService[]; toggleService: (id: string) => void;
}) {
  const selected = services.filter(item => selectedServiceIds.includes(item.id));
  return <section className="grid h-full min-h-0 gap-4 bg-stone-50/95 p-4 sm:p-6" data-customer-display-service-select style={{ gridTemplateRows: "auto minmax(0,1fr) auto" }}>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl"><WorkspaceText text="Hello," /> {(checkIn.visit.firstName || "Guest").toUpperCase()}!</h2>
        <p className="mt-3 text-lg leading-7 text-zinc-600"><WorkspaceText text="What can we do for you today?" /></p></div>
      <button type="button" className="min-h-11 shrink-0 rounded-xl border border-stone-200 bg-white px-4 text-sm font-semibold" disabled={disabled} onClick={onBack}><WorkspaceText text="Back" /></button>
    </header>
    <div className="min-h-0 overflow-y-auto"><div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3" data-customer-display-service-grid>
      {services.map(item => <button type="button" aria-pressed={selectedServiceIds.includes(item.id)} disabled={disabled} onClick={() => toggleService(item.id)} key={item.id}
        style={selectedServiceIds.includes(item.id) ? { borderColor: "#0f766e", backgroundColor: "#ecfdf5" } : undefined}
        className={`grid min-h-24 content-center gap-2 rounded-2xl border-2 p-4 text-left transition disabled:opacity-50 ${selectedServiceIds.includes(item.id) ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-200 bg-white text-zinc-950"}`} data-customer-display-service-card>
        <span className="flex justify-between gap-3 break-words text-lg font-semibold">{item.name}{selectedServiceIds.includes(item.id) ? <span aria-hidden="true">✓</span> : null}</span><span className="text-sm text-zinc-500">{money(item.basePrice)}{item.durationMinutes ? ` · ${item.durationMinutes} min` : ""}</span>
      </button>)}
    </div></div>
    <footer className="grid gap-3 border-t border-stone-200 pt-3">
      <p className="text-sm text-zinc-600" aria-live="polite">{selected.length ? selected.map(item => item.name).join(" · ") : <WorkspaceText text="Choose your services to continue." />}</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-lg font-semibold text-zinc-800"><WorkspaceText text="Estimated total" /> {money(total(selected))}</span>
        <button type="button" disabled={disabled || !selected.length} onClick={onSubmit} className="min-h-14 rounded-xl bg-teal-700 px-8 text-xl font-semibold text-white disabled:bg-zinc-300"><WorkspaceText text={disabled ? "Saving…" : "Confirm check-in"} /></button></div>
    </footer>
  </section>;
}
