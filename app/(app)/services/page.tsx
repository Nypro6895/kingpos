import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { ServicesManager } from "@/app/services/services-manager";
import { ServicesCatalogPilot } from "@/app/services/services-catalog-pilot";
import { servicesCatalogPilotEnabled } from "@/lib/services-catalog-pilot-flag";
import { getExperienceContext } from "@/lib/experience-context";
import "@/app/services/services.css";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import {
  getCurrentSalonServicesWorkspace,
  SERVICE_PERMISSIONS,
} from "@/lib/services";

type ServicesPageProps = {
  searchParams: Promise<{
    service?: string | string[];
    live?: string | string[];
  }>;
};

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function ServicesPage({ searchParams }: ServicesPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/services"),
  ]);
  const canViewServices = await hasPermission(
    SERVICE_PERMISSIONS.view,
    context,
  );

  if (!canViewServices) {
    return (
      <main className="services-page">
        <div className="services-page__frame services-page__empty">
          <WorkspaceText text="You do not have permission to view services." />
        </div>
      </main>
    );
  }

  if (servicesCatalogPilotEnabled() && stringParam(params.live) !== "1") {
    return <ServicesCatalogPilot scope={getExperienceContext(context).scope} serviceId={stringParam(params.service) ?? null} />;
  }

  const data = await getCurrentSalonServicesWorkspace(context);

  return (
    <ServicesManager
      data={data}
      initialServiceId={stringParam(params.service) ?? null}
    />
  );
}

export default withExperiencePage(ServicesPage);
