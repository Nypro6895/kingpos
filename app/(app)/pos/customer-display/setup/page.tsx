import { withExperiencePage } from "@/components/experience-page";
import { getWorkspaceTranslation } from "@/lib/workspace-language-server";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  getCurrentPortablePosSession,
  getRememberedPortablePosAccessId,
} from "@/app/pos/portable/actions";
import { PortablePosLoginForm } from "@/app/pos/portable/portable-login-form";

function ReylumiLogo() {
  return (
    <Image
      alt="Reylumi"
      className="h-auto w-44 object-contain"
      height={419}
      priority
      src="/brand/reylumi-logo-horizontal.png"
      width={1527}
    />
  );
}

async function CustomerDisplaySetupPage() {
  const __vt = await getWorkspaceTranslation();

  const session = await getCurrentPortablePosSession();

  if (session) {
    redirect("/pos/customer-display");
  }

  const rememberedAccessId = await getRememberedPortablePosAccessId();

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-100 px-4 py-8 text-zinc-950">
      <div className="grid w-full max-w-md justify-items-center gap-6">
        <ReylumiLogo />
        <PortablePosLoginForm
          rememberedAccessId={rememberedAccessId}
          returnTo="/pos/customer-display"
          submitLabel={__vt("Pair Display")}
        />
      </div>
    </main>
  );
}

export default withExperiencePage(CustomerDisplaySetupPage);
