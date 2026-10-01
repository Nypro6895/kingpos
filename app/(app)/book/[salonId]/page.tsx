import { PublicBookingClient } from "@/app/book/[salonId]/public-booking-client";
import {
  getPublicBookingPageData,
  type PublicBookingSearchParams,
} from "@/lib/public-booking";

type PublicBookingPageProps = {
  params: Promise<{
    salonId: string;
  }>;
  searchParams: Promise<PublicBookingSearchParams>;
};

export default async function PublicBookingPage({
  params,
  searchParams,
}: PublicBookingPageProps) {
  const [{ salonId }, query] = await Promise.all([params, searchParams]);
  const data = await getPublicBookingPageData(salonId, query);

  return <PublicBookingClient data={data} />;
}
