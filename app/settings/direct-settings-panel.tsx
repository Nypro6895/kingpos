"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useCallback, useEffect, useState } from "react";
import {
  loadDirectSettings,
  type DirectSettingsKind,
} from "./direct-settings-actions";
import {
  buttonClass,
  InlineForm,
  Check,
  type DirectData,
} from "./direct-settings-ui";
import {
  SalonDetailsPanel,
  BookingSettingsPanel,
} from "./salon-settings-panels";
import { TeamSettingsPanel, PayrollSettingsPanel } from "./team-payroll-panels";
import { PosSettingsPanel } from "./pos-settings-panel";
import {
  OwnershipSettingsPanel,
  LifecycleSettingsPanel,
} from "./ownership-lifecycle-panels";
import { ServicesManager } from "@/app/services/services-manager";
import { StaffAvailabilityEditor } from "@/app/booking-setup/booking-setup-editors";
import { StaffPublicProfileEditor } from "@/app/staff/staff-public-profile-editor";
import { RecoveryBackOfficePanel } from "./recovery-back-office/recovery-back-office-panel";
import { staffBookingPreferencesAction } from "@/app/staff/appointments/staff-preferences-actions";
import "@/app/services/services.css";
import "./direct-settings.css";
import { SettingsLoading } from "./settings-loading";
import { getAppLocalHost } from "@/lib/app-local-host";
import { getAppLocalCommandScope } from "@/lib/app-local-command-client";
import { useAppLocalResource } from "@/lib/app-local-resource";
import { useExperienceScope } from "@/components/experience-scope";
import { ShortcutsSettingsPanel } from "./shortcuts-settings-panel";

function OwnPreferences({ salonId }: { salonId: string }) {
  const __vt = useWorkspaceTranslation();

  const [values, setValues] = useState<{
      online: boolean;
      notifications: boolean;
    } | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await staffBookingPreferencesAction(undefined, salonId);
    if (!result.ok) throw new Error(result.error);
    setValues(result);
  }, [salonId]);
  useEffect(() => {
    let active = true;
    staffBookingPreferencesAction(undefined, salonId)
      .then((result) => {
        if (active) {
          if (result.ok) setValues(result);
          else setError(result.error);
        }
      })
      .catch(() => {
        if (active) setError("Could not load booking preferences.");
      });
    return () => {
      active = false;
    };
  }, [salonId]);
  if (!values)
    return (
      <p role={error ? "alert" : "status"} className="text-sm text-zinc-500">
        <WorkspaceText text={error || "Loading booking preferences…"} />
      </p>
    );
  return (
    <div className="grid gap-3">
      {(
        [
          ["online", "Allow customers to book me online"],
          ["notifications", "Notify me about bookings"],
        ] as const
      ).map(([preference, label]) => (
        <InlineForm
          key={`${preference}-${values[preference]}`}
          save={async (form) => {
            const result = await staffBookingPreferencesAction({
              preference,
              enabled: form.get(preference) === "on",
            }, salonId);
            return result.ok
              ? { ok: true }
              : { ok: false, error: result.error };
          }}
          onSaved={load}
        >
          <Check name={preference} label={__vt(label)} checked={values[preference]} />
        </InlineForm>
      ))}
    </div>
  );
}
function Content({
  data,
  reload,
}: {
  data: DirectData;
  reload: () => Promise<void>;
}) {
  switch (data.kind) {
    case "salon-profile":
    case "public-profile":
      return <SalonDetailsPanel data={data} onSaved={reload} />;
    case "shortcuts":
      return <ShortcutsSettingsPanel salonId={data.salonId} configuration={data.configuration} onSaved={reload}/>;
    case "services":
      return (
        <ServicesManager
          data={data.workspace}
          initialServiceId={null}
          embedded
          expectedSalonId={data.salonId}
          onSaved={reload}
        />
      );
    case "booking":
      return <BookingSettingsPanel data={data} onSaved={reload} />;
    case "staff-team":
      return <TeamSettingsPanel data={data} onSaved={reload} />;
    case "payroll":
      return <PayrollSettingsPanel data={data} onSaved={reload} />;
    case "pos-display":
      return <PosSettingsPanel data={data} onSaved={reload} />;
    case "ownership":
      return <OwnershipSettingsPanel data={data} onSaved={reload} />;
    case "close-salon":
      return <LifecycleSettingsPanel data={data} onSaved={reload} />;
    case "staff-workspace":
      return (
        <div className="grid gap-4">
          <StaffPublicProfileEditor
            expectedSalonId={data.salonId}
            onSaved={reload}
            staffId={data.staff.id}
            displayName={data.displayName}
            avatarUrl={data.avatarUrl}
            bio={data.staff.public_bio}
            jobTitle={data.staff.job_title}
            specialties={data.staff.specialties}
          />
          <OwnPreferences salonId={data.salonId} />
        </div>
      );
    case "staff-schedule":
      return (
        <StaffAvailabilityEditor
          staff={[data.staff]}
          availabilityRules={data.availabilityRules}
          timeBlocks={data.timeBlocks}
          timezone={data.timezone}
          readinessByStaffId={{}}
          canManage
          onSaved={reload}
          expectedSalonId={data.salonId}
        />
      );
    case "recovery-back-office":
      return (
        <RecoveryBackOfficePanel overview={data.overview} onSaved={reload} />
      );
    case "roles":
    case "permissions":
      return (
        <div className="grid gap-3">
          <p className="text-sm text-zinc-500">
            <WorkspaceText text="Access rules are read-only. Manage staff access in Staff & Team." />
          </p>
          {data.catalog.roles.map((role) => (
            <details
              className="rounded-lg border border-zinc-200 bg-white p-4"
              key={role.id}
            >
              <summary className="cursor-pointer font-semibold">
                {role.name}
              </summary>
              <ul className="mt-3 grid gap-2 text-sm">
                {role.permissions.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      );
  }
}
type DirectPanelProps = { kind: DirectSettingsKind; salonId?: string; onChanged?:()=>void|Promise<void> };

function NativeDirectSettingsPanel({kind,salonId,onChanged}: DirectPanelProps & {salonId:string}) {
  const scope = getAppLocalCommandScope();
  // Reuse the existing bounded, scoped memory cache. This resource remains
  // retention:none: no settings form is persisted to native/disk storage.
  const state = useAppLocalResource<DirectData>(scope, "settings.direct", {kind,salonId}, {refreshAfterMs:15_000});
  const refresh = state.refresh;
  const reload = useCallback(async () => { try { await refresh(); } finally { await onChanged?.(); } }, [refresh,onChanged]);
  const error = !scope || !state.available || state.accessDenied ? "Your account has changed. Please open the page again." : state.error;
  const data = scope && state.available && !state.accessDenied ? state.data : undefined;
  return <div className="settings-style"><div className="settings-direct-panel grid gap-4">
    {error && <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800"><p><WorkspaceText text={error}/></p><button type="button" className={`${buttonClass} mt-2`} onClick={() => void state.refresh()}><WorkspaceText text="Retry"/></button></div>}
    {data && data.kind === kind && "salonId" in data && data.salonId === salonId ? <Content data={data} reload={reload}/> : !error && <SettingsLoading/>}
  </div></div>;
}

export function DirectSettingsPanel(props: DirectPanelProps) {
  if (getAppLocalHost().isNative && props.salonId && !["recovery-back-office","roles","permissions"].includes(props.kind)) return <NativeDirectSettingsPanel {...props} salonId={props.salonId}/>;
  return <LegacyDirectSettingsPanel {...props}/>;
}

function LegacyDirectSettingsPanel({ kind, salonId, onChanged }: DirectPanelProps) {
  const gate = useExperienceScope(), scope = gate?.context.scope;
  const [data, setData] = useState<DirectData | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const read = useCallback(async (signal?: AbortSignal) => {
    if (scope && salonId && !["recovery-back-office","roles","permissions"].includes(kind)) {
      const response = await getAppLocalHost().read<DirectData>("settings.direct", {kind,salonId}, {scope,signal});
      if (response.scope !== scope || !response.data) throw new Error("Your account has changed. Please open the page again.");
      return response.data;
    }
    return loadDirectSettings(kind, salonId);
  }, [kind, salonId, scope]);
  const reload = useCallback(async () => {
    try {
      const value = await read();
      setData(value);
      setError("");
    } finally { await onChanged?.(); }
  }, [read, onChanged]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    read(controller.signal)
      .then((value) => {
        if (active) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load settings.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [read, retry]);
  return (
    <div className="settings-style"><div className="settings-direct-panel grid gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-800"
        >
          <p><WorkspaceText text={error} /></p>
          <button
            type="button"
            className={`${buttonClass} mt-2`}
            onClick={() => {
              setError("");
              setRetry((n) => n + 1);
            }}
          >
            <WorkspaceText text="Retry" />
          </button>
        </div>
      )}
      {data && data.kind === kind && (!salonId || ("salonId" in data && data.salonId === salonId)) ? (
        <>
          <Content data={data} reload={reload} />
        </>
      ) : (
        !error && (
          <SettingsLoading/>
        )
      )}
    </div></div>
  );
}
