import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { getPortableReportData } from "@/app/pos/portable/actions";
import { PortableReportClosingForm } from "@/app/pos/portable/report/portable-report-closing-form";

type PortableReportPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function PortableReportDenied() {
  return (
    <section
      className="h-full overflow-auto bg-white px-6 py-8 text-zinc-950 sm:px-8 lg:py-10"
      data-portable-pos-page="report"
    >
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-2xl font-semibold tracking-normal">
            <WorkspaceText text="Report unavailable" />
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            <WorkspaceText text="This Portable POS device does not have report access. Enable the restricted Report capability from POS Settings before using this route." />
          </p>
        </div>
      </div>
    </section>
  );
}

async function PortableReportPage({searchParams}: PortableReportPageProps) {
  // Resolve the route input without allowing it to select a historical date.
  await searchParams;
  let data: Awaited<ReturnType<typeof getPortableReportData>>;

  try {
    // Device reports always use today's date in the salon's timezone.
    data = await getPortableReportData();
  } catch {
    return <PortableReportDenied />;
  }

  return (
    <section
      className="h-full overflow-auto bg-white px-6 py-8 text-zinc-950 sm:px-8 lg:py-10"
      data-portable-pos-page="report"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        {data.setupMessage ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <WorkspaceText text={data.setupMessage} />
          </p>
        ) : null}

        <PortableReportClosingForm data={data} />
      </div>
    </section>
  );
}

export default withExperiencePage(PortableReportPage);
