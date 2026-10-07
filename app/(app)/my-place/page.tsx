import { listMyOwnerTransferInvites } from "@/lib/owner-transfer";
import { MyPlaceClient } from "@/app/my-place/my-place-client";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getPlaceRequests } from "@/app/my-place/actions";
import { inspectProfilePhoneClaim } from "@/lib/customer-identity-claims";
import { redirect } from "next/navigation";

type MyPlacePageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function MyPlacePage({ searchParams }: MyPlacePageProps) {
  const [resolvedSearchParams, context] = await Promise.all([
    searchParams ?? Promise.resolve({ error: undefined }),
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login?next=/my-place");
  }

  const [requests, phoneClaim, ownerInvites] = await Promise.all([
    getPlaceRequests(),
    context.user.phone
      ? inspectProfilePhoneClaim(context.user.phone)
      : Promise.resolve(null),
    listMyOwnerTransferInvites()
      .then((invites) => ({ invites, error: undefined }))
      .catch(() => {
        console.error("My Place owner invitations could not be loaded.");
        return { invites: [], error: "Owner invitations could not be loaded. Please retry." };
      }),
  ]);

  return (
    <MyPlaceClient
      currentWorkspace={context.currentWorkspace}
      user={context.user}
      phoneVerified={
        phoneClaim?.ok === true && phoneClaim.data.verifiedByCurrentUser
      }
      error={resolvedSearchParams.error}
      requests={requests}
      ownerInvites={ownerInvites.invites}
      ownerInvitesError={ownerInvites.error}
      salons={[
        ...context.availableManageSalons,
        ...context.availableStaffSalons,
      ]}
      workspaceOptions={context.workspaceOptions}
    />
  );
}
