"use client";

import { useMemo } from "react";

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

type QrCodeTileProps = {
  ariaLabel: string;
  className?: string;
  dataKind?: "claim" | "download" | "setup";
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
        : dataKind === "claim"
          ? { "data-customer-claim-qr": true }
          : {};

  if (!qr) {
    return <div className={fallbackClassName}>{fallbackMessage}</div>;
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
