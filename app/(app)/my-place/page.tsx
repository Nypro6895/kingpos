import { MyPlaceClient } from "@/app/my-place/my-place-client";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getWorkspacePendingSummary } from "@/lib/workspace-pending";
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

  const pendingSummary = await getWorkspacePendingSummary(context);

  return (
    <MyPlaceClient
      currentWorkspace={context.currentWorkspace}
      error={resolvedSearchParams.error}
      pendingSummary={pendingSummary}
      workspaceOptions={context.workspaceOptions}
    />
  );
}
