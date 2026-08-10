"use client";

import { QrCodeTile } from "@/components/qr-code-tile";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function useAbsoluteUrl(path: string) {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setOrigin(window.location.origin);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return origin ? new URL(path, origin).toString() : path;
}

function useInstallState() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & {
      standalone?: boolean;
    };

    const timeoutId = window.setTimeout(() => {
      setIsIos(
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      );
      setIsStandalone(
        window.matchMedia("(display-mode: standalone)").matches ||
          Boolean(navigatorWithStandalone.standalone),
      );
    }, 0);

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  return { installEvent, isIos, isStandalone, setInstallEvent };
}

function SetupQr({ valueToEncode }: { valueToEncode: string }) {
  return (
    <QrCodeTile
      ariaLabel="Customer Display setup QR code"
      dataKind="setup"
      fallbackMessage="Setup link is too long for the local QR tile. Use copy link."
      valueToEncode={valueToEncode}
    />
  );
}

export function CustomerDisplayInstallPanel({
  activeAccessKeyCount,
  displayPath,
  schemaReady,
  setupPath,
}: {
  activeAccessKeyCount: number;
  displayPath: string;
  schemaReady: boolean;
  setupPath: string;
}) {
  const displayUrl = useAbsoluteUrl(displayPath);
  const setupUrl = useAbsoluteUrl(setupPath);
  const { installEvent, isIos, isStandalone, setInstallEvent } =
    useInstallState();
  const [status, setStatus] = useState<string | null>(null);
  const canPair = schemaReady && activeAccessKeyCount > 0;

  async function copy(valueToCopy: string, label: string) {
    try {
      await navigator.clipboard.writeText(valueToCopy);
      setStatus(`${label} copied.`);
    } catch {
      setStatus(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function installApp() {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      setStatus(
        choice.outcome === "accepted"
          ? "Install started."
          : "Install dismissed.",
      );
      return;
    }

    setStatus(
      isIos
        ? "On iPad, open the setup link in Safari, then use Share and Add to Home Screen."
        : "Use the browser install or app menu after opening the display.",
    );
  }

  return (
    <section
      className="rounded-lg border border-zinc-200 bg-white p-5"
      id="customer-display-install"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">
            Customer Display App
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Install or pair an iPad kiosk using the same POS ID and passcode
            managed above. The setup URL does not include the live checkout
            token.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a
              className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-zinc-800"
              href={displayPath}
              rel="noreferrer"
              target="_blank"
            >
              Open Customer Display
            </a>
            <button
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canPair}
              onClick={() => void copy(setupUrl, "Setup link")}
              type="button"
            >
              Copy Setup Link
            </button>
            <button
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              onClick={() => void copy(displayUrl, "Display link")}
              type="button"
            >
              Copy Display Link
            </button>
            <button
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isStandalone}
              onClick={() => void installApp()}
              type="button"
            >
              {isStandalone ? "Installed" : "Install App"}
            </button>
          </div>

          {!schemaReady ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Apply the Portable POS access migration before pairing a display.
            </p>
          ) : activeAccessKeyCount === 0 ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Create an active POS ID above before pairing a customer display.
            </p>
          ) : null}
          {status ? (
            <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700">
              {status}
            </p>
          ) : null}
          {isIos && !isStandalone ? (
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              iPad setup: scan the QR in Safari, pair with POS ID/passcode, then
              use Share and Add to Home Screen.
            </p>
          ) : null}
        </div>

        <div className="grid justify-items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-center">
          <SetupQr valueToEncode={setupUrl} />
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            Setup QR
          </p>
        </div>
      </div>
    </section>
  );
}
