"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState } from "react";
import {
  saveDirectStaff,
  runDirectStaffRequest,
  saveDirectPayroll,
} from "./direct-settings-actions";
import {
  Field,
  Check,
  Select,
  InlineForm,
  text,
  number,
  checked,
  type DirectData,
} from "./direct-settings-ui";
import type { StaffDirectoryMember } from "@/lib/staff";
import { StaffPublicProfileEditor } from "@/app/staff/staff-public-profile-editor";
import { saveSettingsPublicTeam } from "./settings-extra-actions";
import { DeleteUnusedButton } from "./delete-unused-button";
import { resetDirectStaffPasscode } from "./direct-pos-actions";
export function TeamSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "staff-team" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const [adding, setAdding] = useState(false);
  function editor(staff?: StaffDirectoryMember) {
    return (
      <InlineForm
        key={staff?.id ?? "new"}
        label={__vt(staff ? "Save staff" : "Create staff")}
        onSaved={async () => {
          await onSaved();
          if (!staff) setAdding(false);
        }}
        save={(form) => {
          const common = {
            display_name: text(form, "display_name"),
            first_name: text(form, "first_name") || null,
            last_name: text(form, "last_name") || null,
            phone: text(form, "phone") || null,
            email: text(form, "email") || null,
            job_title: text(form, "job_title") || null,
            address_line1: staff?.address_line1,
            address_line2: staff?.address_line2,
            city: staff?.city,
            state: staff?.state,
            postal_code: staff?.postal_code,
            is_active: checked(form, "is_active"),
            pos_enabled: checked(form, "pos_enabled"),
          };
          return saveDirectStaff(
            data.salonId,
            staff
              ? {
                  ...common,
                  staff_id: staff.id,
                  online_booking_enabled: checked(
                    form,
                    "online_booking_enabled",
                  ),
                  salon_profile_content_posting_enabled: checked(
                    form,
                    "salon_profile_content_posting_enabled",
                  ),
                }
              : common,
          );
        }}
      >
        <Field
          name="display_name"
          label={__vt("Display name")}
          value={staff?.display_name}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="first_name"
            label={__vt("First name")}
            value={staff?.first_name}
          />
          <Field name="last_name" label={__vt("Last name")} value={staff?.last_name} />
          <Field name="email" label={__vt("Email")} type="email" value={staff?.email} />
          <Field name="phone" label={__vt("Phone")} type="tel" value={staff?.phone} />
        </div>
        <Field name="job_title" label={__vt("Position")} value={staff?.job_title} />
        <Check
          name="is_active"
          label={__vt("Active staff")}
          checked={staff?.is_active ?? true}
        />
        <Check
          name="pos_enabled"
          label={__vt("Allow POS access")}
          checked={staff?.pos_enabled ?? true}
        />
        {staff && (
          <>
            <Check
              name="online_booking_enabled"
              label={__vt("Allow online booking")}
              checked={staff.online_booking_enabled}
            />
            <Check
              name="salon_profile_content_posting_enabled"
              label={__vt("Allow salon content posts")}
              checked={staff.salon_profile_content_posting_enabled}
            />
          </>
        )}
      </InlineForm>
    );
  }
  return (
    <div className="grid gap-4">
      {data.canManage && (
        <>
          <button
            className="min-h-10 justify-self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white"
            onClick={() => setAdding(!adding)}
          >
            <WorkspaceText text={adding ? "Close form" : "+ Add staff"} />
          </button>
          {adding && editor()}
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              <WorkspaceText text="Invite staff" />
            </summary>
            <div className="mt-3">
              <InlineForm
                label={__vt("Send invitation")}
                save={(form) =>
                  runDirectStaffRequest(data.salonId, {
                    action: "invite",
                    email: text(form, "email"),
                    name: text(form, "name"),
                    staffId: text(form,"staff_id")||undefined,
                  })
                }
                onSaved={onSaved}
              >
                <Select name="staff_id" label={__vt("Staff profile")} value="" options={[["","Create a new staff profile"],...data.staff.filter(s=>!s.account_user_id&&!s.user_id).map(s=>[s.id,s.display_name] as const)]}/><Field name="name" label={__vt("Staff name (for new profile)")} />
                <Field name="email" label={__vt("Email")} type="email" required />
              </InlineForm>
            </div>
          </details>
        </>
      )}
      {!data.staff.length && (
        <p className="text-sm text-zinc-500"><WorkspaceText text="No staff yet." /></p>
      )}
      {data.staff.map((staff) => (
        <details
          className="rounded-lg border border-zinc-200 bg-white p-4"
          key={staff.id}
        >
          <summary className="cursor-pointer font-semibold">
            {staff.staff_profile_display_name || staff.display_name}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              <WorkspaceText text={staff.job_title ?? "Staff"} /> ·{" "}
              <WorkspaceText text={staff.is_active ? "Active" : "Inactive"} />
            </span>
          </summary>
          <div className="mt-3 grid gap-3">
            <p className="text-sm text-zinc-600"><WorkspaceText text={staff.connected_user?`${staff.connected_user.email||staff.connected_user.display_name||staff.connected_user.id} is linked to this staff profile`:`No app account is linked${staff.email?` · Contact: ${staff.email}`:""}`} /></p>
            {data.canManage ? (
              <>
                {editor(staff)}
                <details><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Public staff profile · photo, bio & specialties" /></summary><div className="mt-3"><StaffPublicProfileEditor expectedSalonId={data.salonId} staffId={staff.id} displayName={staff.staff_profile_display_name||staff.display_name} avatarUrl={staff.staff_profile_avatar_url} bio={staff.public_bio} jobTitle={staff.job_title} specialties={staff.specialties} canEditSalonRole showPasscodeControls={false} onSaved={onSaved}/></div></details>
                {data.canManagePublicTeam?<details><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Public team order" /></summary><div className="mt-3"><InlineForm onSaved={onSaved} label={__vt("Save public team order")} save={form=>saveSettingsPublicTeam(data.salonId,[{staffId:staff.id,profileDisplayOrder:number(form,"profile_display_order"),onlineBookingEnabled:staff.online_booking_enabled,salonProfileContentPostingEnabled:staff.salon_profile_content_posting_enabled}])}><Field name="profile_display_order" label={__vt("Display order (lower comes first)")} type="number" min={0} value={staff.profile_display_order}/><p className="text-xs text-zinc-500"><WorkspaceText text={staff.public_profile_visible?"Visible on the salon website":"Hidden on the salon website"} /></p></InlineForm></div></details>:null}
                <DeleteUnusedButton kind="staff" id={staff.id} name={staff.display_name} expectedSalonId={data.salonId} onDeleted={onSaved}/>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    <WorkspaceText text="Reset POS passcode" />
                  </summary>
                  <div className="mt-3">
                    <InlineForm
                      save={(form) =>
                        resetDirectStaffPasscode(data.salonId, staff.id, form)
                      }
                      onSaved={onSaved}
                      label={__vt("Reset passcode")}
                    >
                      <Field
                        name="passcode"
                        label={__vt("New passcode (4–8 digits)")}
                        type="password"
                        required
                      />
                    </InlineForm>
                  </div>
                </details>
              </>
            ) : (
              <p className="text-sm text-zinc-500"><WorkspaceText text="Read-only for your role." /></p>
            )}
          </div>
        </details>
      ))}
      {data.requests
        .filter((r) => r.status === "pending")
        .map((request) => (
          <div
            className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4"
            key={request.id}
          >
            <p className="text-sm font-semibold">
              <WorkspaceText text={request.staff?.display_name ??
                request.account?.display_name ??
                request.target_email_normalized ??
                "Staff request"} />
            </p>
            <p className="text-sm text-zinc-500">
              <WorkspaceText text={request.direction === "salon_invite"
                ? "Invitation pending"
                : "Application pending"} />
              {request.requested_job_title
                ? ` · ${request.requested_job_title}`
                : ""}
            </p>
            {request.message && <p className="text-sm"><WorkspaceText text={request.message} /></p>}
            {data.canManage && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(request.direction === "staff_application"
                  ? (["accept", "decline"] as const)
                  : (["resend", "revoke"] as const)
                ).map((action) => (
                  <InlineForm
                    key={action}
                    label={__vt({
                        accept: "Accept",
                        decline: "Decline",
                        resend: "Resend invitation",
                        revoke: "Revoke invitation",
                      }[action])}
                    save={() =>
                      runDirectStaffRequest(data.salonId, {
                        action,
                        requestId: request.id,
                      })
                    }
                    onSaved={onSaved}
                  >
                    <span className="sr-only">{action} <WorkspaceText text="staff request" /></span>
                  </InlineForm>
                ))}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

export function PayrollSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "payroll" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  if (!data.canManage)
    return (
      <p className="text-sm text-zinc-500">
        <WorkspaceText text="Payroll settings are read-only for your role." />
      </p>
    );
  return (
    <div className="grid gap-4">
      <InlineForm
        label={__vt("Save pay cycle")}
        save={(form) =>
          saveDirectPayroll(data.salonId, {
            cycleType: text(form, "cycle_type") as
              "monthly" | "semi_monthly" | "biweekly",
            biweeklyAnchorDate: text(form, "anchor") || null,
          })
        }
        onSaved={onSaved}
      >
        <Select
          name="cycle_type"
          label={__vt("Pay cycle")}
          value={data.schedule.cycle_type}
          options={[
            ["monthly", "Monthly"],
            ["semi_monthly", "Twice monthly"],
            ["biweekly", "Every two weeks"],
          ]}
        />
        <Field
          name="anchor"
          label={__vt("Anchor date (required for every two weeks)")}
          type="date"
          value={data.schedule.biweekly_anchor_date}
        />
      </InlineForm>
      {data.staff.map((row) => {
        const s = row.setting;
        return (
          <details
            className="rounded-lg border border-zinc-200 bg-white p-4"
            key={row.staff.id}
          >
            <summary className="cursor-pointer font-semibold">
              {row.staffProfileDisplayName || row.staff.display_name}
            </summary>
            <div className="mt-3">
              <InlineForm
                save={(form) =>
                  saveDirectPayroll(data.salonId, {
                    staffId: row.staff.id,
                    effectiveFrom: text(form, "effective_from"),
                    legalName: text(form, "legal_name") || null,
                    payType:
                      text(form, "pay_type") === "fixed"
                        ? "fixed"
                        : "commission",
                    commissionRate: number(form, "commission_rate"),
                    fixedPayAmount: number(form, "fixed_pay_amount"),
                    checkRate: number(form, "check_rate"),
                    taxRate: number(form, "tax_rate"),
                    taxTips: checked(form, "tax_tips"),
                    taxBonus: checked(form, "tax_bonus"),
                    cashToTaxCompany: checked(form, "cash_to_tax_company"),
                    applyTaxToFixedPay: checked(form, "apply_tax_to_fixed_pay"),
                    tipPayoutMethod:
                      text(form, "tip_payout_method") === "check"
                        ? "check"
                        : "cash",
                    bonusPayoutMethod:
                      text(form, "bonus_payout_method") === "check"
                        ? "check"
                        : "cash",
                  })
                }
                onSaved={onSaved}
              >
                <Field
                  name="effective_from"
                  label={__vt("Effective from")}
                  type="date"
                  value={s?.effective_from ?? data.today}
                  required
                />
                <Field
                  name="legal_name"
                  label={__vt("Legal name")}
                  value={s?.legal_name}
                />
                <Select
                  name="pay_type"
                  label={__vt("Pay type")}
                  value={s?.pay_type ?? "commission"}
                  options={[
                    ["commission", "Commission"],
                    ["fixed", "Fixed pay"],
                  ]}
                />
                <Field
                  name="commission_rate"
                  label={__vt("Commission (%)")}
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={s?.commission_rate ?? 60}
                  required
                />
                <Field
                  name="fixed_pay_amount"
                  label={__vt("Fixed pay ($)")}
                  type="number"
                  step="0.01"
                  min={0}
                  value={s?.fixed_pay_amount ?? 0}
                  required
                />
                <Field
                  name="check_rate"
                  label={__vt("Check share (%)")}
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={s?.check_rate ?? 60}
                  required
                />
                <Field
                  name="tax_rate"
                  label={__vt("Tax company rate (%)")}
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={s?.tax_rate ?? 0}
                  required
                />
                <Check
                  name="tax_tips"
                  label={__vt("Include tips in tax company calculation")}
                  checked={s?.tax_tips}
                />
                <Check
                  name="tax_bonus"
                  label={__vt("Include bonuses in tax company calculation")}
                  checked={s?.tax_bonus}
                />
                <Check
                  name="cash_to_tax_company"
                  label={__vt("Send cash portion to tax company")}
                  checked={s?.cash_to_tax_company}
                />
                <Check
                  name="apply_tax_to_fixed_pay"
                  label={__vt("Apply tax company rate to fixed pay")}
                  checked={s?.apply_tax_to_fixed_pay}
                />
                <Select
                  name="tip_payout_method"
                  label={__vt("Tip payout")}
                  value={s?.tip_payout_method ?? "cash"}
                  options={[
                    ["cash", "Cash"],
                    ["check", "Check"],
                  ]}
                />
                <Select
                  name="bonus_payout_method"
                  label={__vt("Bonus payout")}
                  value={s?.bonus_payout_method ?? "check"}
                  options={[
                    ["cash", "Cash"],
                    ["check", "Check"],
                  ]}
                />
              </InlineForm>
            </div>
          </details>
        );
      })}
    </div>
  );
}
