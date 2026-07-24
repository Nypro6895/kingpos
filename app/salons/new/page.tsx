import { SalonManagementPage } from "@/app/salons/salon-management-page";

type NewSalonPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default function NewSalonPage({ searchParams }: NewSalonPageProps) {
  return <SalonManagementPage mode="create" searchParams={searchParams} />;
}
