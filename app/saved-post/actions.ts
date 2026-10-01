"use server";

import {
  getAccountSavedPostCounts,
  getAccountSavedPostStateKeys,
  hasAccountSocialSession,
  isAccountSocialAuthRequiredError,
  setAccountSavedPost,
  toggleAccountSavedPost,
} from "@/lib/account-social";
import { revalidatePath } from "next/cache";
import { savedPostKey, type AccountSavedPostTarget } from "@/types/saved-post";

export type ToggleSavedPostResult = {
  active: boolean;
  authRequired: boolean;
  error: string | null;
  saveCount: number | null;
};

export type SavedPostStatesResult = {
  canSave: boolean;
  error: string | null;
  saveCountsByKey: Record<string, number>;
  savedKeys: string[];
};

async function readSaveCount(target: AccountSavedPostTarget) {
  try {
    const counts = await getAccountSavedPostCounts([target]);

    return counts.get(savedPostKey(target)) ?? null;
  } catch (error) {
    console.error("Saved post count refresh failed", {
      error,
      target,
    });

    return null;
  }
}

export async function toggleAccountSavedPostAction(
  target: AccountSavedPostTarget,
): Promise<ToggleSavedPostResult> {
  try {
    const active = await toggleAccountSavedPost(target);
    const saveCount = await readSaveCount(target);

    revalidatePath("/more/saved-post");
    revalidatePath("/more/saved-designs");

    if (target.salonId) {
      revalidatePath(`/explore/salons/${target.salonId}`);
    }

    return { active, authRequired: false, error: null, saveCount };
  } catch (error) {
    const authRequired = isAccountSocialAuthRequiredError(error);

    if (!authRequired) {
      console.error("Saved post toggle failed", {
        error,
        target,
      });
    }

    return {
      active: false,
      authRequired,
      error: authRequired
        ? "Sign in to save posts."
        : error instanceof Error
          ? error.message
          : "Saved post could not be updated.",
      saveCount: null,
    };
  }
}

export async function setAccountSavedPostAction(
  target: AccountSavedPostTarget,
  active: boolean,
): Promise<ToggleSavedPostResult> {
  try {
    const nextActive = await setAccountSavedPost(target, active);
    const saveCount = await readSaveCount(target);

    revalidatePath("/more/saved-post");
    revalidatePath("/more/saved-designs");

    if (target.salonId) {
      revalidatePath(`/explore/salons/${target.salonId}`);
    }

    return { active: nextActive, authRequired: false, error: null, saveCount };
  } catch (error) {
    const authRequired = isAccountSocialAuthRequiredError(error);

    if (!authRequired) {
      console.error("Saved post set failed", {
        active,
        error,
        target,
      });
    }

    return {
      active: !active,
      authRequired,
      error: authRequired
        ? "Sign in to save posts."
        : error instanceof Error
          ? error.message
          : "Saved post could not be updated.",
      saveCount: null,
    };
  }
}

export async function getAccountSavedPostStatesAction(
  targets: AccountSavedPostTarget[],
): Promise<SavedPostStatesResult> {
  try {
    const [keys, canSave] = await Promise.all([
      getAccountSavedPostStateKeys(targets),
      hasAccountSocialSession(),
    ]);
    let countsByKey: Record<string, number> = {};

    try {
      const counts = await getAccountSavedPostCounts(targets);
      countsByKey = Object.fromEntries(counts);
    } catch (countError) {
      console.error("Saved post counts check failed", {
        error: countError,
        targets,
      });
    }

    return {
      canSave,
      error: null,
      saveCountsByKey: countsByKey,
      savedKeys: [...keys],
    };
  } catch (error) {
    console.error("Saved post state check failed", {
      error,
      targets,
    });

    return {
      canSave: false,
      error:
        error instanceof Error ? error.message : "Saved posts could not be checked.",
      saveCountsByKey: {},
      savedKeys: [],
    };
  }
}
