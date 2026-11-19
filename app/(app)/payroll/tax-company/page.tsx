import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { OwnerTaxReport } from "@/app/tax/owner-tax-report";
import PayrollTaxCompanyLiveReport from "@/app/payroll/tax-company-live-report";
import { isOwnerMembership } from "@/lib/current-context";
import { loadOwnerTaxReport, type OwnerTaxReportData } from "@/lib/owner-tax-report";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { taxQaRequest } from "@/lib/tax-workspace-qa";

type ReportQuery = {
  report?: string;
  end?: string;
  month?: string;
  payroll_error?: string;
  payPeriodStart?: string;
  preset?: string;
  segment?: string;
  start?: string;
};

async function OwnerTaxPage({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const query = await searchParams;
  const qa = await taxQaRequest();
  if (qa?.mode === "owner") {
    return <OwnerTaxReport key={JSON.stringify(query)} data={{ salon: qa.data.salon, runs: qa.data.runs, lines: qa.data.lines }} initialPeriod={query} sample />;
  }

  const context = await requireSalonManagePageContext("/payroll/tax-company");
  if (!isOwnerMembership(context.currentMembership)) {
    return <PayrollTaxCompanyLiveReport searchParams={Promise.resolve(query)} />;
  }

  let data: OwnerTaxReportData | null = null;
  try {
    data = await loadOwnerTaxReport(context);
  } catch {
    // A failed read stays unavailable; never substitute live payroll numbers.
  }
  if (!data) {
    return (
      <main className="flex min-w-0 flex-col gap-3 px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold"><WorkspaceText text="Tax" /></h1>
        <p role="alert" className="text-sm text-amber-800">
          <WorkspaceText text="Tax reporting figures could not load. Please try again." />
        </p>
      </main>
    );
  }
  return <OwnerTaxReport key={`${context.currentSalon?.id}:${JSON.stringify(query)}`} data={data} initialPeriod={query} />;
}

export default withExperiencePage(OwnerTaxPage);
