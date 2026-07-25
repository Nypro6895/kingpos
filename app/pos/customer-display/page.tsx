import { CustomerDisplayClient } from "@/app/pos/customer-display/customer-display-client";
import { getOrCreatePosLiveDraft } from "@/app/pos/actions";
import {
  getCurrentPortablePosSession,
  getPortablePosDeskData,
} from "@/app/pos/portable/actions";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { getPublicPosDisplaySettingsByToken } from "@/lib/pos-settings";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";

type CustomerDisplayPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

async function resolveCustomerDisplayToken(explicitToken: string) {
  const token = explicitToken.trim();

  if (token) {
    return token;
  }

  try {
    const context = await getCurrentBusinessContext();

    if (
      context.user &&
      context.currentSalon &&
      isSalonManageContext(context) &&
      (await hasPermission(POS_TICKET_PERMISSIONS.manage, context))
    ) {
      const liveDraftResult = await getOrCreatePosLiveDraft();
      return liveDraftResult.ok ? liveDraftResult.data.token : "";
    }
  } catch {
    // Fall through to portable POS context.
  }

  try {
    const portableSession = await getCurrentPortablePosSession();

    if (portableSession) {
      const data = await getPortablePosDeskData();
      return data.liveDraft?.token ?? "";
    }
  } catch {
    // Public customer display links without an active POS session use defaults.
  }

  return "";
}

export default async function CustomerDisplayPage({
  searchParams,
}: CustomerDisplayPageProps) {
  const { token = "" } = await searchParams;
  const resolvedToken = await resolveCustomerDisplayToken(token);
  const settings = await getPublicPosDisplaySettingsByToken(resolvedToken);

  return (
    <main className="h-dvh overflow-hidden bg-zinc-950 text-white">
      <CustomerDisplayClient settings={settings} token={resolvedToken} />
    </main>
  );
}
