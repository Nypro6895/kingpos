import { ServicesManager } from "@/app/services/services-manager";
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
  }>;
};

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
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
          You do not have permission to view services.
        </div>
      </main>
    );
  }

  const data = await getCurrentSalonServicesWorkspace(context);

  return (
    <ServicesManager
      data={data}
      initialServiceId={stringParam(params.service) ?? null}
    />
  );
}
