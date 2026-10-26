import { withExperiencePage } from "@/components/experience-page";
import { SalonManagementPage } from "@/app/salons/salon-management-page";

type SalonsPageProps = {
  searchParams: Promise<{
    created?: string | string[];
    error?: string | string[];
  }>;
};

function SalonsPage({ searchParams }: SalonsPageProps) {
  return <SalonManagementPage mode="list" searchParams={searchParams} />;
}

export default withExperiencePage(SalonsPage);
