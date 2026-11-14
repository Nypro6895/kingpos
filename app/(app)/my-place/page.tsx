import { withExperiencePage } from "@/components/experience-page";
import { listMyOwnerTransferInvites } from "@/lib/owner-transfer";
import { MyPlaceProgressiveClient } from "@/app/my-place/my-place-client";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getPlaceRequests } from "@/app/my-place/actions";
import { inspectProfilePhoneClaim } from "@/lib/customer-identity-claims";
import { redirect } from "next/navigation";

type MyPlacePageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

async function MyPlacePage({ searchParams }: MyPlacePageProps) {
  const [resolvedSearchParams, context] = await Promise.all([
    searchParams ?? Promise.resolve({ error: undefined }),
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login?next=/my-place");
  }

  // Context already contains the admitted workspaces. These independent reads
  // belong to their profile/request fragments, not the workspace list.
  const requests = getPlaceRequests().catch(() => ({ ok: false as const, message: "Requests could not be loaded. Please retry." }));
  const phoneVerified = context.user.phone
    ? inspectProfilePhoneClaim(context.user.phone)
      .then(claim => claim.ok ? claim.data.verifiedByCurrentUser : null)
      .catch(() => null)
    : Promise.resolve(false);
  const invitations = listMyOwnerTransferInvites()
      .then((invites) => ({ invites, error: undefined }))
      .catch(() => {
        console.error("My Place owner invitations could not be loaded.");
        return { invites: [], error: "Owner invitations could not be loaded. Please retry." };
      });

  return (
    <MyPlaceProgressiveClient
      key={context.user.id}
      currentWorkspace={context.currentWorkspace}
      user={context.user}
      phoneVerified={phoneVerified}
      error={resolvedSearchParams.error}
      requests={requests}
      invitations={invitations}
      salons={[
        ...context.availableManageSalons,
        ...context.availableStaffSalons,
      ]}
      workspaceOptions={context.workspaceOptions}
    />
  );
}

export default withExperiencePage(MyPlacePage);
