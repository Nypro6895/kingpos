export type ParsedPosAmountInput =
  | {
      error: string;
      isValid: false;
      parts: [];
      total: 0;
    }
  | {
      error: null;
      isValid: true;
      parts: number[];
      total: number;
    };

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parsePosAmountInput(input: string): ParsedPosAmountInput {
  const value = input.trim();

  if (!value) {
    return { error: "Enter an amount.", isValid: false, parts: [], total: 0 };
  }

  if (value.includes("//") || value.startsWith("/") || value.endsWith("/")) {
    return {
      error: "Slash parts cannot be empty.",
      isValid: false,
      parts: [],
      total: 0,
    };
  }

  const rawParts = value.split("/");
  const parts: number[] = [];

  for (const rawPart of rawParts) {
    if (!/^\d+(\.\d{1,2})?$/.test(rawPart)) {
      return {
        error: "Use positive numbers with up to 2 decimals.",
        isValid: false,
        parts: [],
        total: 0,
      };
    }

    const amount = Number(rawPart);

    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        error: "Each part must be greater than 0.",
        isValid: false,
        parts: [],
        total: 0,
      };
    }

    parts.push(roundMoney(amount));
  }

  return {
    error: null,
    isValid: true,
    parts,
    total: roundMoney(parts.reduce((sum, amount) => sum + amount, 0)),
  };
}

export function getTurnType(amount: number, largeTurnThreshold: number) {
  return amount >= largeTurnThreshold ? "large" : "small";
}
