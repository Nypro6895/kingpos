import { WorkspaceText } from "@/components/workspace-language";

/** Only pass a public URL after the server has confirmed public availability. */
export function SalonPublicationStatus({ publicHref }: { publicHref: string | null }) {
  if (publicHref) {
    return null;
  }

  return <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
    <p className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Not public" /></p>
    <p className="text-sm text-zinc-600"><WorkspaceText text="This profile is not public yet. You can preview it in the salon workspace." /></p>
  </div>;
}
