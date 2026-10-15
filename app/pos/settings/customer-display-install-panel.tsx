"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { QrCodeTile } from "@/components/qr-code-tile";
import { useEffect, useState } from "react";

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

function useIsIos() {
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsIos(
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      );
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return isIos;
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
  const isIos = useIsIos();
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

  return (
    <div className="settings-style"><section
      className="settings-section-body settings-display-setup"
      id="customer-display-install"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">
            <WorkspaceText text="Connect a display" />
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            <WorkspaceText text="Open here, or scan the QR code on another device and sign in with a POS ID." />
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a
              className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-zinc-800"
              href={displayPath}
              rel="noreferrer"
              target="_blank"
            >
              <WorkspaceText text="Open Customer Display" />
            </a>
            <button
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canPair}
              onClick={() => void copy(setupUrl, "Setup link")}
              type="button"
            >
              <WorkspaceText text="Copy Setup Link" />
            </button>
            <button
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              onClick={() => void copy(displayUrl, "Display link")}
              type="button"
            >
              <WorkspaceText text="Copy Display Link" />
            </button>
            <a
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-center text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              href={setupPath}
              rel="noreferrer"
              target="_blank"
            >
              <WorkspaceText text="Install App" />
            </a>
          </div>

          {!schemaReady ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              <WorkspaceText text="Display pairing is temporarily unavailable. Please try again later or contact support." />
            </p>
          ) : activeAccessKeyCount === 0 ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              <WorkspaceText text="Create an active POS ID above before pairing a customer display." />
            </p>
          ) : null}
          {status ? (
            <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700">
              <WorkspaceText text={status} />
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            <WorkspaceText text="Use the browser install or app menu after opening the display." />
          </p>
          {isIos ? (
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              <WorkspaceText text="iPad setup: scan the QR in Safari, pair with POS ID/passcode, then use Share and Add to Home Screen." />
            </p>
          ) : null}
        </div>

        <div className="settings-qr grid justify-items-center gap-2 text-center">
          <SetupQr valueToEncode={setupUrl} />
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <WorkspaceText text="Setup QR" />
          </p>
        </div>
      </div>
    </section></div>
  );
}
