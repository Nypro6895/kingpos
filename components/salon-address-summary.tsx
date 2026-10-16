import { WorkspaceText } from "@/components/workspace-language";
import type { NormalizedPublicSalonAddress } from "@/types/location";

export function SalonAddressSummary({ address }: { address: NormalizedPublicSalonAddress }) {
  const hasAddress = address.city || address.state || address.postalCode || !address.missingParts.includes("addressLine1");
  return (
    <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-semibold"><WorkspaceText text="Saved salon address" /></h3>
      <p className="whitespace-pre-line break-words text-sm">
        {hasAddress ? address.formattedAddress : <WorkspaceText text="No address saved yet." />}
      </p>
      <p className="text-sm text-zinc-600">
        <WorkspaceText text="Your address is shown as text. A map is not required to set up your salon or booking." />
      </p>
    </div>
  );
}
