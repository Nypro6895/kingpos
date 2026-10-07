import { PortableOfflineShell } from "@/app/pos/portable/portable-offline-shell";
import Image from "next/image";
import { Suspense } from "react";
import { PortablePanels } from "@/app/pos/portable/portable-panels";
import PortablePosPage from "./page";
import PortableCheckInPage from "./check-in/page";
import PortableBookPage from "./book/page";
import PortableReportPage from "./report/page";
import PortableTicketPage from "./ticket/page";
import {
  getCurrentPortablePosSession,
  getRememberedPortablePosAccessId,
} from "@/app/pos/portable/actions";
import { PortablePosLoginForm } from "@/app/pos/portable/portable-login-form";
import { PortableShellRefresh } from "@/app/pos/portable/portable-shell-refresh";
import { PortableWorkspaceTabs } from "@/app/pos/portable/portable-workspace-tabs";
import { PortableWorkspaceStateProvider } from "@/app/pos/portable/portable-workspace-state";
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

async function PreparedPanel({ render }: { render: () => Promise<React.ReactNode> }) {
  try { return await render(); }
  catch {
    return <p role="alert" className="p-6">This view could not load. Other loaded tabs remain available. Reconnect and refresh to try again.</p>;
  }
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

import { PortableTouchKeyboard } from "@/app/pos/portable/touch-keyboard";

export default async function PortablePosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentPortablePosSession();
  // This server response timestamp bounds replay against the cached HTML snapshot.
  // eslint-disable-next-line react-hooks/purity
  const preparedAt = Date.now();

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

    if (link.id === "ticket") return session.capabilities.includes(PORTABLE_POS_CAPABILITIES.todayView);
    return false;
  });

  const panelPages: Record<string, React.ReactNode> = {
    ticket: <PreparedPanel render={() => PortableTicketPage({ searchParams: Promise.resolve({}) })} />,
    pos: <PreparedPanel render={() => PortablePosPage()} />,
    checkIn: <PreparedPanel render={() => PortableCheckInPage()} />,
    book: <PreparedPanel render={() => PortableBookPage({ searchParams: Promise.resolve({}) })} />,
    report: <PreparedPanel render={() => PortableReportPage({ searchParams: Promise.resolve({}) })} />,
  };
  const panels: Record<string, React.ReactNode> = {};
  // Offline reload must carry every permitted panel in its HTML snapshot.
  // Online-only sessions load a panel on first visit and retain it thereafter.
  const offlineEnabled = process.env.KINGPOS_PORTABLE_DRAFT_OUTBOX === "1";
  for (const link of offlineEnabled ? workspaceLinks : []) {
    panels[link.href] = <Suspense fallback={<p role="status" className="p-6">Loading {link.label}…</p>}>
      {panelPages[link.id]}
    </Suspense>;
  }


  return (
    <main
      className="portable-kiosk-surface relative flex h-dvh w-dvw flex-col overflow-hidden bg-zinc-100 text-zinc-950"
      data-portable-pos-shell
      data-portable-shell
      data-pos-persistent-workspace
    >
      <PortableWorkspaceStateProvider timezone={session.salon_timezone} preparedAt={preparedAt} offlineEnabled={process.env.KINGPOS_PORTABLE_DRAFT_OUTBOX === "1"} scope={`${session.salon_id}:${session.key_id}`}>
        <PortableWorkspaceTabs
          canConfirmBookings={session.capabilities.includes(PORTABLE_POS_CAPABILITIES.bookCreate)}
          localPanels
          items={workspaceLinks}
          salonId={session.salon_id}
          salonLogoUrl={session.salon_logo_url}
          salonName={session.salon_name}
          salonTimezone={session.salon_timezone}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <PortablePanels panels={panels} allowedPaths={workspaceLinks.map(link=>link.href)}>{children}</PortablePanels>
        </div>
        <PortableOfflineShell />
        <PortableShellRefresh />
        <PortableTouchKeyboard enabled={session.touch_keyboard_enabled !== false} />
      </PortableWorkspaceStateProvider>
    </main>
  );
}
