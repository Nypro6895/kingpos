import { GuestManageClient } from "@/app/booking/manage/[token]/guest-manage-client";
import { getGuestManagePageData } from "@/lib/public-booking";

type GuestManagePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function GuestManagePage({ params }: GuestManagePageProps) {
  const { token } = await params;
  const data = await getGuestManagePageData(token);

  return <GuestManageClient data={data} token={token} />;
}
