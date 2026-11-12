import {TaxRenewal} from "@/app/tax/tax-renewal";
import {TaxInvitation} from "@/app/tax/tax-invitation";
import { notFound } from "next/navigation";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
import { TaxWorkspace } from "@/app/tax/tax-workspace";
import { taxWorkspaceOption } from "@/lib/tax-role";
import { StaffPayrollSettingInlineEdit } from "@/app/payroll/staff-payroll-setting-inline-edit";
import type { Staff } from "@/types/staff";
import { TaxActivationFollowup } from "@/app/tax/tax-activation-followup";
import { OwnerConnectionPanel } from "@/app/tax/owner-connection-panel";
export default async function TaxQaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const qa = await taxQaRequest();
  if (!qa) notFound();
  const view=(await searchParams).view;
  if(view==='renewal'&&qa.mode==='owner')return <main className="tax-app" style={{maxWidth:1050,margin:'32px auto',padding:20}}><p>Local QA · actual renewal component · sample pricing · no real payment</p><TaxRenewal salonId={qa.data.salon.id} active={false}/><OwnerConnectionPanel state={{active:false,enabled:true,login_id:'TAX-QA-LUMI',connections:[]}} salonId={qa.data.salon.id}/></main>;
  if(view==='invitation')return <TaxInvitation token={'a'.repeat(64)} salonName={qa.data.salon.name} active profile={null} name={qa.profile?.display_name??''} email={qa.profile?.contact_email??''}/>;
  if (qa.mode === "owner" && (await searchParams).view === "setting")
    return (
      <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
        <p>
          Local QA · actual owner settings component · no production connection
        </p>
        <StaffPayrollSettingInlineEdit
          salonPayrollSetting={{
            id: "qa",
            salon_id: qa.data.salon.id,
            cycle_type: "semi_monthly",
            biweekly_anchor_date: null,
            created_at: "2026-11-10",
            updated_at: "2026-11-10",
          }}
          period={{
            startDate: "2026-11-01",
            endDate: "2026-11-15",
            cycleType: "semi_monthly",
            preset: "semi_monthly_first",
            label: "Nov 1 – Nov 15, 2026",
          }}
          returnPath="/payroll"
          setting={null}
          staff={
            {
              id: "00000000-0000-4000-8000-000000000040",
              display_name: "Anna Nguyen",
            } as Staff
          }
          staffProfileAvatarUrl={null}
          staffProfileDisplayName="Anna Nguyen"
        />
      </main>
    );
  const data =
    qa.mode === "staff"
      ? {
          ...qa.data,
          lines: qa.data.lines.filter(
            (l) => l.staff_id === "00000000-0000-4000-8000-000000000040",
          ),
          documents: qa.data.documents.filter(
            (d) => d.recipient_user_id === qa.userId,
          ),
          runs: [],
          messages: [],
          receipts: [],
          events: [],
        }
      : qa.data;
  const tax = taxWorkspaceOption(),
    workspaces = [
      {
        ...tax,
        id: "personal",
        type: "personal" as const,
        label: "Personal",
        roleLabel: "Personal",
        defaultHref: "/explore",
      },
      {
        ...tax,
        id: "manage:qa",
        type: "salon" as const,
        salonMode: "manage" as const,
        label: "Lumi Nail Studio",
        roleLabel: "Owner",
        defaultHref: "/payroll",
      },
      {
        ...tax,
        id: "staff:qa",
        type: "salon" as const,
        salonMode: "staff" as const,
        label: "Lotus Beauty",
        roleLabel: "Staff",
        defaultHref: "/staff/my-work",
      },
      tax,
    ];
  const ownerConnection =
    qa.mode === "owner"
      ? {
          active: true,
          enabled: true,
          login_id: "TAX-QA-LUMI",
          connections: [
            {
              user_id: "qa-tax",
              display_name: "Taylor Nguyen",
              email: "taylor@example.test",
              phone: null,
              connected_at: "2026-11-07T12:00:00Z",
              account_active: true,
            },
          ],
        }
      : undefined;
  if(ownerConnection&&view==="connection")return <main className="tax-app" style={{maxWidth:1050,margin:"24px auto",padding:20}}><OwnerConnectionPanel state={ownerConnection} salonId={qa.data.salon.id}/></main>;
  if (ownerConnection && (await searchParams).view === "activation")
    return (
      <main
        className="tax-app"
        style={{ maxWidth: 1050, margin: "24px auto", padding: 20 }}
      >
        <p>Local QA · actual activation components · seeded data</p>
        <TaxActivationFollowup active salonId={qa.data.salon.id} />
        <OwnerConnectionPanel
          salonId={qa.data.salon.id}
          state={{
            ...ownerConnection,
            login_id: null,
            enabled: false,
            connections: [],
          }}
        />
      </main>
    );
  return (
    <TaxWorkspace
      initialData={data}
      mode={qa.mode}
      profile={qa.mode === "owner" ? null : qa.profile}
      salons={[{ id: qa.data.salon.id, name: qa.data.salon.name }]}
      workspaces={workspaces}
      today="2026-11-09"
      qa
      ownerConnection={ownerConnection}
    />
  );
}
