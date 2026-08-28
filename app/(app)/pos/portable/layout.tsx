import Image from "next/image";
import {
  getCurrentPortablePosSession,
  getRememberedPortablePosAccessId,
} from "@/app/pos/portable/actions";
import { PortableFloatingNav } from "@/app/pos/portable/portable-floating-nav";
import { PortableFullscreenButton } from "@/app/pos/portable/portable-fullscreen-button";
import { PortablePosLoginForm } from "@/app/pos/portable/portable-login-form";
import { PortableShellRefresh } from "@/app/pos/portable/portable-shell-refresh";
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

  const routeLinks = PORTABLE_POS_ROUTE_LINKS.filter((link) => {
    if (link.id === "pos") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.posUse);
    }

    if (link.id === "ticket") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.todayView);
    }

    if (link.id === "checkIn") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.checkInUse);
    }

    if (link.id === "book") {
      return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.bookView);
    }

    return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.reportView);
  });

  return (
    <main
      className="portable-kiosk-surface relative h-dvh w-dvw overflow-hidden bg-zinc-100 text-zinc-950"
      data-portable-pos-shell
      data-portable-shell
    >
      <div className="h-full min-h-0 overflow-hidden">{children}</div>
      <PortableShellRefresh />
      <PortableFullscreenButton />
      <PortableFloatingNav items={routeLinks} salonName={session.salon_name} />
    </main>
  );
}
