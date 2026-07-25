"use client";

import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type QrCode = {
  cells: boolean[][];
  size: number;
};

const QR_VERSION = 6;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_DATA_CODEWORDS = 136;
const QR_BLOCK_DATA_CODEWORDS = 68;
const QR_ECC_CODEWORDS = 18;
const QR_MAX_BYTES = 134;
const QR_MASK_PATTERN = 0;

const GF_EXP = new Array<number>(512).fill(0);
const GF_LOG = new Array<number>(256).fill(0);

let value = 1;
for (let index = 0; index < 255; index += 1) {
  GF_EXP[index] = value;
  GF_LOG[value] = index;
  value <<= 1;
  if (value & 0x100) {
    value ^= 0x11d;
  }
}
for (let index = 255; index < GF_EXP.length; index += 1) {
  GF_EXP[index] = GF_EXP[index - 255] ?? 0;
}

function gfMultiply(left: number, right: number) {
  if (left === 0 || right === 0) {
    return 0;
  }

  return GF_EXP[(GF_LOG[left] ?? 0) + (GF_LOG[right] ?? 0)] ?? 0;
}

function reedSolomonGenerator(degree: number) {
  let result = [1];

  for (let degreeIndex = 0; degreeIndex < degree; degreeIndex += 1) {
    const next = new Array<number>(result.length + 1).fill(0);

    for (let coefficient = 0; coefficient < result.length; coefficient += 1) {
      next[coefficient] ^= result[coefficient] ?? 0;
      next[coefficient + 1] ^=
        gfMultiply(result[coefficient] ?? 0, GF_EXP[degreeIndex] ?? 0);
    }

    result = next;
  }

  return result;
}

const QR_ECC_GENERATOR = reedSolomonGenerator(QR_ECC_CODEWORDS);

function reedSolomonRemainder(data: number[]) {
  const result = new Array<number>(QR_ECC_CODEWORDS).fill(0);

  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);

    for (let index = 0; index < QR_ECC_CODEWORDS; index += 1) {
      result[index] ^= gfMultiply(QR_ECC_GENERATOR[index + 1] ?? 0, factor);
    }
  }

  return result;
}

function appendBits(bits: number[], valueToAppend: number, bitLength: number) {
  for (let index = bitLength - 1; index >= 0; index -= 1) {
    bits.push((valueToAppend >>> index) & 1);
  }
}

function encodeBytePayload(data: Uint8Array) {
  const bits: number[] = [];

  appendBits(bits, 0b0100, 4);
  appendBits(bits, data.length, 8);

  for (const byte of data) {
    appendBits(bits, byte, 8);
  }

  const maxBits = QR_DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, maxBits - bits.length));

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(Number.parseInt(bits.slice(index, index + 8).join(""), 2));
  }

  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < QR_DATA_CODEWORDS) {
    codewords.push(padBytes[padIndex % padBytes.length] ?? 0);
    padIndex += 1;
  }

  return codewords;
}

function getFormatBits(maskPattern: number) {
  const data = (0b01 << 3) | maskPattern;
  let remainder = data << 10;

  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((remainder >>> bit) & 1) !== 0) {
      remainder ^= 0x537 << (bit - 10);
    }
  }

  return ((data << 10) | remainder) ^ 0x5412;
}

function createQrMatrix(codewords: number[]): QrCode {
  const cells = Array.from({ length: QR_SIZE }, () =>
    new Array<boolean | null>(QR_SIZE).fill(null),
  );
  const reserved = Array.from({ length: QR_SIZE }, () =>
    new Array<boolean>(QR_SIZE).fill(false),
  );

  function setFunctionModule(x: number, y: number, dark: boolean) {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) {
      return;
    }

    cells[y]![x] = dark;
    reserved[y]![x] = true;
  }

  function drawFinderPattern(x: number, y: number) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        const isFinder =
          dx >= 0 &&
          dx <= 6 &&
          dy >= 0 &&
          dy <= 6 &&
          (dx === 0 ||
            dx === 6 ||
            dy === 0 ||
            dy === 6 ||
            (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));

        setFunctionModule(xx, yy, isFinder);
      }
    }
  }

  function drawAlignmentPattern(centerX: number, centerY: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunctionModule(
          centerX + dx,
          centerY + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  function drawFormatBits() {
    const format = getFormatBits(QR_MASK_PATTERN);

    for (let index = 0; index <= 5; index += 1) {
      setFunctionModule(8, index, ((format >>> index) & 1) !== 0);
    }
    setFunctionModule(8, 7, ((format >>> 6) & 1) !== 0);
    setFunctionModule(8, 8, ((format >>> 7) & 1) !== 0);
    setFunctionModule(7, 8, ((format >>> 8) & 1) !== 0);
    for (let index = 9; index < 15; index += 1) {
      setFunctionModule(14 - index, 8, ((format >>> index) & 1) !== 0);
    }

    for (let index = 0; index < 8; index += 1) {
      setFunctionModule(QR_SIZE - 1 - index, 8, ((format >>> index) & 1) !== 0);
    }
    for (let index = 8; index < 15; index += 1) {
      setFunctionModule(8, QR_SIZE - 15 + index, ((format >>> index) & 1) !== 0);
    }

    setFunctionModule(8, QR_SIZE - 8, true);
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(QR_SIZE - 7, 0);
  drawFinderPattern(0, QR_SIZE - 7);
  drawAlignmentPattern(34, 34);

  for (let index = 8; index < QR_SIZE - 8; index += 1) {
    setFunctionModule(6, index, index % 2 === 0);
    setFunctionModule(index, 6, index % 2 === 0);
  }

  drawFormatBits();

  const dataBits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, index) => (codeword >>> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;

      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const x = right - columnOffset;

        if (reserved[y]![x]) {
          continue;
        }

        const rawBit = (dataBits[bitIndex] ?? 0) === 1;
        const mask = (x + y) % 2 === 0;
        cells[y]![x] = rawBit !== mask;
        bitIndex += 1;
      }
    }

    upward = !upward;
  }

  drawFormatBits();

  return {
    cells: cells.map((row) => row.map((cell) => Boolean(cell))),
    size: QR_SIZE,
  };
}

function createQrCode(valueToEncode: string) {
  const data = new TextEncoder().encode(valueToEncode);

  if (data.length > QR_MAX_BYTES) {
    return null;
  }

  const dataCodewords = encodeBytePayload(data);
  const blockOne = dataCodewords.slice(0, QR_BLOCK_DATA_CODEWORDS);
  const blockTwo = dataCodewords.slice(QR_BLOCK_DATA_CODEWORDS);
  const eccOne = reedSolomonRemainder(blockOne);
  const eccTwo = reedSolomonRemainder(blockTwo);
  const interleaved: number[] = [];

  for (let index = 0; index < QR_BLOCK_DATA_CODEWORDS; index += 1) {
    interleaved.push(blockOne[index] ?? 0, blockTwo[index] ?? 0);
  }
  for (let index = 0; index < QR_ECC_CODEWORDS; index += 1) {
    interleaved.push(eccOne[index] ?? 0, eccTwo[index] ?? 0);
  }

  return createQrMatrix(interleaved);
}

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

type QrCodeTileProps = {
  ariaLabel: string;
  className?: string;
  dataKind?: "download" | "setup";
  fallbackClassName?: string;
  fallbackMessage: string;
  valueToEncode: string;
};

export function QrCodeTile({
  ariaLabel,
  className = "aspect-square w-44 rounded-md bg-white p-3 shadow-sm",
  dataKind,
  fallbackClassName = "grid aspect-square w-44 place-items-center rounded-md border border-dashed border-zinc-300 bg-white p-4 text-center text-xs font-medium text-zinc-500",
  fallbackMessage,
  valueToEncode,
}: QrCodeTileProps) {
  const qr = useMemo(() => createQrCode(valueToEncode), [valueToEncode]);
  const dataProps =
    dataKind === "setup"
      ? { "data-customer-display-setup-qr": true }
      : dataKind === "download"
        ? { "data-customer-display-download-qr": true }
        : {};

  if (!qr) {
    return (
      <div className={fallbackClassName}>
        {fallbackMessage}
      </div>
    );
  }

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      role="img"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      {...dataProps}
    >
      <rect fill="#ffffff" height={qr.size} width={qr.size} />
      {qr.cells.flatMap((row, y) =>
        row.map((cell, x) =>
          cell ? (
            <rect
              fill="#18181b"
              height="1"
              key={`${x}-${y}`}
              width="1"
              x={x}
              y={y}
            />
          ) : null,
        ),
      )}
    </svg>
  );
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
