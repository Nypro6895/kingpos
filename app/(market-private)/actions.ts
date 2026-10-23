"use server";

import { revalidatePath } from "next/cache";
import { marketRegistryRpc, registryActionError } from "@/lib/market-registry/server";
import { MarketRegistryInputError, registryHash, registryId, registryReason, registryVersion, validateMarketRegistryManifest } from "@/lib/market-registry/manifest";
import type { MarketRegistryActionResult } from "@/types/market-registry";

function fields(form: FormData, allowed: string[]) {
  for (const key of form.keys()) {
    if (!key.startsWith("$ACTION_") && (!allowed.includes(key) || form.getAll(key).length !== 1)) {
      throw new MarketRegistryInputError("This form contains unexpected fields. Reload and try again.");
    }
  }
}

async function mutate(operation: () => Promise<unknown>, message: string): Promise<MarketRegistryActionResult> {
  try {
    await operation();
    revalidatePath("/developers/market");
    revalidatePath("/market-review");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, message: registryActionError(error) };
  }
}

export async function saveDraftAction(_previous: MarketRegistryActionResult, form: FormData) {
  return mutate(async () => {
    fields(form, ["appId", "expectedVersion", "appVersion", "displayName", "description"]);
    const appId = form.get("appId");
    const manifest = validateMarketRegistryManifest({
      manifestSchemaVersion: 1, appVersion: form.get("appVersion"), displayName: form.get("displayName"),
      description: form.get("description"), requestedCapabilities: [],
    });
    return marketRegistryRpc("market_registry_save_draft", {
      p_app_id: appId ? registryId(appId) : null,
      p_expected_version: registryVersion(form.get("expectedVersion"), !appId),
      p_manifest: manifest,
    });
  }, "Draft saved. You can return to it before submitting.");
}

export async function submitDraftAction(_previous: MarketRegistryActionResult, form: FormData) {
  return mutate(async () => {
    fields(form, ["appId", "expectedVersion"]);
    return marketRegistryRpc("market_registry_submit", {
      p_app_id: registryId(form.get("appId")), p_expected_version: registryVersion(form.get("expectedVersion")),
    });
  }, "Submitted for metadata review. This does not publish or activate the app.");
}

export async function withdrawSubmissionAction(_previous: MarketRegistryActionResult, form: FormData) {
  return mutate(async () => {
    fields(form, ["submissionId", "expectedHash"]);
    return marketRegistryRpc("market_registry_withdraw", {
      p_submission_id: registryId(form.get("submissionId")), p_expected_hash: registryHash(form.get("expectedHash")),
    });
  }, "Submission withdrawn. You can save a new draft revision.");
}

export async function reviewSubmissionAction(_previous: MarketRegistryActionResult, form: FormData) {
  return mutate(async () => {
    fields(form, ["submissionId", "expectedVersion", "expectedHash", "decision", "reason"]);
    const decision = form.get("decision");
    if (decision !== "metadata_approved" && decision !== "rejected") throw new MarketRegistryInputError("Choose a review decision.");
    return marketRegistryRpc("market_registry_review", {
      p_submission_id: registryId(form.get("submissionId")), p_expected_version: registryVersion(form.get("expectedVersion")),
      p_expected_hash: registryHash(form.get("expectedHash")), p_decision: decision, p_reason: registryReason(form.get("reason")),
    });
  }, "Review recorded. The app remains private and cannot be installed.");
}
