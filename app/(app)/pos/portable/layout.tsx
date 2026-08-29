import Image from "next/image";
import {
  getCurrentPortablePosSession,
  getRememberedPortablePosAccessId,
} from "@/app/pos/portable/actions";
import { PortableFullscreenButton } from "@/app/pos/portable/portable-fullscreen-button";
import { PortablePosLoginForm } from "@/app/pos/portable/portable-login-form";
import { PortableShellRefresh } from "@/app/pos/portable/portable-shell-refresh";
import { PortableWorkspaceTabs } from "@/app/pos/portable/portable-workspace-tabs";
import { PORTABLE_POS_CAPABILITIES } from "@/lib/pos-portable-capabilities";
import { PORTABLE_POS_ROUTE_LINKS } from "@/lib/pos-portable-routes";

function ReylumiLogo() {
  return (
    <Image
      alt="Reylumi"
      className="h-auto w-40 object-contain"
      height={419}
      priority
      src="/brand/reylumi-logo-horizontal.png"
      width={1527}
    />
  );
}

async function PortableLoginScreen() {
  const rememberedAccessId = await getRememberedPortablePosAccessId();

  return (
    <main className="grid h-dvh place-items-center overflow-hidden bg-zinc-100 px-4 py-8 text-zinc-950">
      <div className="grid w-full justify-items-center gap-6">
        <ReylumiLogo />
        <PortablePosLoginForm rememberedAccessId={rememberedAccessId} />
      </div>
    </main>
  );
}

export default async function PortablePosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentPortablePosSession();

  if (!session) {
    return <PortableLoginScreen />;
  }

  const workspaceLinks = PORTABLE_POS_ROUTE_LINKS.filter((link) => {
    if (link.id === "pos") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.posUse);
    }

    if (link.id === "checkIn") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.checkInUse);
    }

    if (link.id === "book") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.bookView);
    }

    if (link.id === "report") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.reportView);
    }

    return false;
  }).map((link) =>
    link.id === "pos"
      ? {
          ...link,
          label: "Ticket",
        }
      : link,
  );

  return (
    <main
      className="portable-kiosk-surface relative flex h-dvh w-dvw flex-col overflow-hidden bg-zinc-100 text-zinc-950"
      data-portable-pos-shell
      data-portable-shell
      data-pos-persistent-workspace
    >
      <PortableWorkspaceTabs
        items={workspaceLinks}
        salonName={session.salon_name}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <PortableShellRefresh />
      <PortableFullscreenButton />
    </main>
  );
}
