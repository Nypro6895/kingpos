"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState } from "react";
import {
  runDirectOwnership,
  runDirectLifecycle,
} from "./direct-settings-actions";
import { downloadSettingsSalonBackup, resolveSettingsClosureRecord } from "./settings-extra-actions";
import {
  Field,
  Check,
  InlineForm,
  buttonClass,
  type DirectData,
} from "./direct-settings-ui";
export function OwnershipSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "ownership" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <div className="grid gap-4">
      <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {data.roster.owners.map((owner) => (
          <div className="p-4" key={owner.id}>
            <p className="text-sm font-semibold">
              {owner.email ?? owner.name ?? owner.id} <WorkspaceText text="owns" /> {data.salonName}
              <WorkspaceText text={owner.isCurrentUser ? " · You" : ""} />
            </p>
            {owner.name && owner.email && (
              <p className="mt-1 text-sm text-zinc-500">{owner.email}</p>
            )}
          </div>
        ))}
      </div>
      <details><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Former owners" /></summary><div className="mt-3 grid gap-2">
        {data.historyError?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={data.historyError} /></p>:data.history.length?data.history.map(owner=><p key={owner.id} className="text-sm"><WorkspaceText text={owner.email||owner.name||`Deleted account ${owner.accountId}`} /> <WorkspaceText text="left ownership of" /> {data.salonName} <WorkspaceText text="on" /> <WorkspaceText text={new Date(owner.date).toLocaleString("en-US")} />{owner.reason?` · ${owner.reason}`:""}.</p>):<p className="text-sm text-zinc-500"><WorkspaceText text="No former owners are recorded for" /> {data.salonName}.</p>}
      </div></details>
      {([['add_co_owner','Add co-owner'],['transfer_ownership','Transfer ownership']] as const).map(([mode,label])=><details key={mode}><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text={label} /></summary><div className="mt-3">
       <InlineForm save={form=>runDirectOwnership(data.salonId,form)} onSaved={onSaved} label={__vt("Send invitation")}>
        <input type="hidden" name="action" value="invite"/><input type="hidden" name="mode" value={mode}/>
        <Field name="email" label={__vt("Recipient email")} type="email" required/><Field name="message" label={__vt("Message (optional)")}/>
        {mode==='transfer_ownership'?<Check name="relinquish" label={__vt("Remove my ownership after this account accepts")} checked/>:null}
       </InlineForm></div></details>)}
      {data.invites.map((invite) => (
        <InlineForm
          key={invite.id}
          save={(form) => runDirectOwnership(data.salonId, form)}
          onSaved={onSaved}
          label={__vt("Revoke invitation")}
        >
          <input type="hidden" name="action" value="revoke" />
          <input type="hidden" name="invite_id" value={invite.id} />
          <p className="text-sm">
            <WorkspaceText text={invite.target_email_normalized ?? "Owner invitation"} /> ·{" "}
            <WorkspaceText text={invite.mode === "add_co_owner" ? "Co-owner" : "Ownership transfer"} />
          </p>
          <p className="text-xs text-zinc-500">
            <WorkspaceText text="Expires" /> <WorkspaceText text={new Date(invite.expires_at).toLocaleDateString("en-US")} />
          </p>
        </InlineForm>
      ))}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-red-700">
          <WorkspaceText text="Leave ownership" />
        </summary>
        <div className="mt-3">
          {data.roster.canLeave ? (
            <InlineForm
              save={(form) => runDirectOwnership(data.salonId, form)}
              onSaved={onSaved}
              danger
              label={__vt("Leave ownership")}
            >
              <input type="hidden" name="action" value="leave" />
              <Check
                name="confirmed"
                label={__vt("I understand that I will lose owner access to this salon")}
                required
              />
            </InlineForm>
          ) : (
            <p className="text-sm text-zinc-500">
              <WorkspaceText text="The last owner cannot leave. Add another owner first." />
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
export function LifecycleSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "close-salon" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const status = data.lifecycle.lifecycleStatus;
  return (
    <div className="grid gap-4">
      <p className="text-sm font-semibold">
        <WorkspaceText text="Salon status:" /> <WorkspaceText text={status.replaceAll("_", " ")} />
      </p>
      <button
        type="button"
        className={`${buttonClass} justify-self-start`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await downloadSettingsSalonBackup(data.salonId);
            if (result.error || !result.signedUrl || !result.filename)
              throw new Error(result.error ?? "Could not prepare backup.");
            const link = document.createElement("a");
            link.href = result.signedUrl;
            link.download = result.filename;
            link.rel = "noopener";
            document.body.appendChild(link);
            link.click();
            link.remove();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not prepare backup.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <WorkspaceText text={busy ? "Preparing backup…" : "Download backup"} />
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          <WorkspaceText text={error} />
        </p>
      )}
      {status === "permanently_closed" ? (
        <p className="text-sm text-zinc-500">
          <WorkspaceText text="This salon is permanently closed. Historical records remain available." />
        </p>
      ) : (
        <>
          <InlineForm
            save={(form) =>
              runDirectLifecycle(
                data.salonId,
                status === "active" ? "disable" : "reactivate",
                form,
              )
            }
            onSaved={onSaved}
            label={__vt(status === "active"
                ? "Temporarily disable salon"
                : "Reactivate salon")}
            danger={status === "active"}
          >
            <Field name="reason" label={__vt("Reason (optional)")} />
            <Check
              name="confirmed"
              label={__vt(status === "active"
                  ? "Pause new business activity and keep historical records"
                  : "Allow business activity to resume")}
              required
            />
          </InlineForm>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-red-700">
              <WorkspaceText text="Permanently close salon" />
            </summary>
            <div className="mt-3 grid gap-3">
              {data.closureDetails.appointments.map(booking=>{
                const customer=Array.isArray(booking.customer)?booking.customer[0]:booking.customer;
                const staff=Array.isArray(booking.staff)?booking.staff[0]:booking.staff;
                return <details key={booking.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">{customer?.name||customer?.phone||`Booking ${booking.id}`} · <WorkspaceText text={new Date(booking.start_at).toLocaleString("en-US")} /> · <WorkspaceText text={booking.status.replaceAll('_',' ')} /></summary><div className="mt-3 grid gap-3"><p className="text-sm"><WorkspaceText text="Staff:" /> <WorkspaceText text={staff?.display_name||'Unassigned'} />{customer?.phone?` · ${customer.phone}`:''}</p>
                <InlineForm danger label={__vt("Update booking")} onSaved={onSaved} save={form=>resolveSettingsClosureRecord(data.salonId,{kind:'booking',id:booking.id,updatedAt:booking.updated_at,action:form.get('command')==='complete'?'complete':'cancel',reason:String(form.get('reason')||''),confirmed:form.get('confirmed')==='on'})}>
                  <label className="grid gap-1 text-sm"><WorkspaceText text="Action" /><select name="command" className="rounded-md border p-2"><option value="cancel"><WorkspaceText text="Cancel booking" /></option>{booking.status==='in_service'?<option value="complete"><WorkspaceText text="Complete service" /></option>:null}</select></label><Field name="reason" label={__vt("Reason")} required/><Check name="confirmed" label={__vt("Confirm this booking change")} required/>
                </InlineForm></div></details>;
              })}
              {data.closureDetails.tickets.map(ticket=>{const customer=Array.isArray(ticket.customer)?ticket.customer[0]:ticket.customer;return <details key={ticket.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Ticket" /> {ticket.ticket_number} · {customer?.name||customer?.phone||'Walk-in'} · <WorkspaceText text={new Date(ticket.opened_at).toLocaleString("en-US")} /></summary><div className="mt-3"><InlineForm danger label={__vt("Cancel open ticket")} onSaved={onSaved} save={form=>resolveSettingsClosureRecord(data.salonId,{kind:'ticket',id:ticket.id,updatedAt:ticket.updated_at,reason:String(form.get('reason')||''),confirmed:form.get('confirmed')==='on'})}><Field name="reason" label={__vt("Cancellation reason")} required/><Check name="confirmed" label={__vt("Confirm ticket cancellation")} required/></InlineForm></div></details>;})}
              {data.review.blockingRecords.filter(record=>record.count>0&&!['future_bookings','pending_bookings','open_pos_tickets'].includes(record.id)).map(record=><p className="text-sm text-amber-800" key={record.id}><WorkspaceText text={record.label} />: {record.count}</p>)}
              {data.review.canClose ? (
                <InlineForm
                  save={(form) =>
                    runDirectLifecycle(data.salonId, "close", form)
                  }
                  onSaved={onSaved}
                  danger
                  label={__vt("Permanently close salon")}
                >
                  <p className="text-sm">
                    <WorkspaceText text="This closes the salon permanently and keeps historical access." />
                  </p>
                  <Field
                    name="confirmation_name"
                    label={__vt(`Type “${data.salonName}” to confirm`)}
                    required
                  />
                  <Field name="reason" label={__vt("Closure reason (optional)")} />
                  <Check
                    name="backup_acknowledged"
                    label={__vt("I have downloaded a backup or chosen to proceed without one")}
                    required
                  />
                  <Check
                    name="confirmed"
                    label={__vt("I understand this is permanent")}
                    required
                  />
                </InlineForm>
              ) : (
                <p className="text-sm text-zinc-500">
                  <WorkspaceText text="Resolve the items above before closing this salon." />
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
