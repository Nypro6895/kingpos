import { SalonManagementPage } from "@/app/salons/salon-management-page";

type SalonsPageProps = {
  searchParams: Promise<{
    created?: string | string[];
    error?: string | string[];
  }>;
};

export default function SalonsPage({ searchParams }: SalonsPageProps) {
  return <SalonManagementPage mode="list" searchParams={searchParams} />;
}
