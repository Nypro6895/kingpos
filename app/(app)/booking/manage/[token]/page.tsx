import { GuestManageClient } from "@/app/booking/manage/[token]/guest-manage-client";
import { getGuestManagePageData } from "@/lib/public-booking";
import { getCurrentKingUser } from "@/lib/users/current-user";

type GuestManagePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    claim?: string;
  }>;
};

export default async function GuestManagePage({
  params,
  searchParams,
}: GuestManagePageProps) {
  const [{ token }, { claim }] = await Promise.all([params, searchParams]);
  const [data, currentUser] = await Promise.all([
    getGuestManagePageData(token),
    getCurrentKingUser(),
  ]);

  return (
    <GuestManageClient
      claimIntent={claim === "1"}
      currentUser={
        currentUser
          ? {
              displayName: currentUser.display_name,
              email: currentUser.email,
              id: currentUser.id,
            }
          : null
      }
      data={data}
      token={token}
    />
  );
}
