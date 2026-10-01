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

  const [requests, phoneClaim] = await Promise.all([
    getPlaceRequests(),
    context.user.phone
      ? inspectProfilePhoneClaim(context.user.phone)
      : Promise.resolve(null),
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
      salons={[
        ...context.availableManageSalons,
        ...context.availableStaffSalons,
      ]}
      workspaceOptions={context.workspaceOptions}
    />
  );
}
