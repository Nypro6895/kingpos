"use server";

import {
  upsertDailyPosClosing,
  type SaveDailyPosClosingInput,
} from "@/lib/daily-pos-report";
import type { DailyPosClosingInputs } from "@/types/pos-daily-closing";
import { revalidatePath } from "next/cache";

type SaveDailyPosClosingResult =
  | {
      closingInputs: DailyPosClosingInputs;
      error?: never;
      ok: true;
    }
  | {
      closingInputs?: never;
      error: string;
      ok: false;
    };

function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to save daily closing.";
}

export async function saveDailyPosClosing(
  input: SaveDailyPosClosingInput,
): Promise<SaveDailyPosClosingResult> {
  try {
    const closingInputs = await upsertDailyPosClosing(input);

    revalidatePath("/reports");

    return { closingInputs, ok: true };
  } catch (error) {
    return {
      error: getSafeErrorMessage(error),
      ok: false,
    };
  }
}
