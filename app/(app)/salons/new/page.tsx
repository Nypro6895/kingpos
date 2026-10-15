import { withExperiencePage } from "@/components/experience-page";
import { SalonManagementPage } from "@/app/salons/salon-management-page";

type NewSalonPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

function NewSalonPage({ searchParams }: NewSalonPageProps) {
  return <SalonManagementPage mode="create" searchParams={searchParams} />;
}

export default withExperiencePage(NewSalonPage);
