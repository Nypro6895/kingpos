"use server";
import { currentOwnerSalon } from "@/lib/market-platform/owner";
import { platformRpc, PlatformError } from "@/lib/market-platform/server";
import { publicGroup } from "@/lib/market-platform/published-contract";
export type PublicationState = { ok: boolean; message: string; uncertain?: boolean };
export async function savePublication(
  _state: PublicationState,
  form: FormData,
): Promise<PublicationState> {
  let attempted = false;
  try {
    const allowed = [
      "salon",
      "group",
      "revision",
      "payload",
      "intent",
      "consent",
    ];
    for (const key of form.keys())
      if (
        !key.startsWith("$ACTION_") &&
        (!allowed.includes(key) || form.getAll(key).length !== 1)
      )
        throw new PlatformError("Unexpected publication fields.");
    const salon = await currentOwnerSalon(form.get("salon")),
      group = String(form.get("group")),
      revision = String(form.get("revision")),
      intent = String(form.get("intent"));
    if (
      !publicGroup(group) ||
      !/^\d{1,9}$/.test(revision) ||
      !["publish", "draft", "unpublish", "discard"].includes(intent)
    )
      throw new PlatformError(
        "Choose a public data group and current revision.",
      );
    if (intent === "publish" && form.get("consent") !== "yes")
      throw new PlatformError(
        "Confirm that these fields and photos are approved for public sharing.",
      );
    const raw = String(form.get("payload"));
    if (!["unpublish","discard"].includes(intent) && Buffer.byteLength(raw) > 131072)
      throw new PlatformError("Public group exceeds 128 KiB.");
    const payload = intent === "unpublish" || intent === "discard" ? null : JSON.parse(raw);
    attempted = true;
    const result = await platformRpc<unknown>("save_publication", {
      p_salon: salon,
      p_group: group,
      p_expected: Number(revision),
      p_data: payload,
      p_intent: intent,
    });
    if (!Number.isSafeInteger(result) || result !== Number(revision)+1)
      throw new PlatformError("Publication result is uncertain. Reload to check the current draft and sharing state.", "unknown");
    return {
      ok: true,
      message:
        intent === "publish"
          ? "Published. Apps with this group permission can read this revision."
          : intent === "discard" ? "Draft discarded. The shared revision is unchanged."
          : intent === "unpublish"
            ? "Sharing stopped for this group."
            : "Draft saved. Any published revision remains shared until you publish changes or stop sharing.",
    };
  } catch (error) {
    if (attempted && (!(error instanceof PlatformError) || error.outcome === "unknown"))
      return {ok:false,uncertain:true,message:"Publication result is uncertain. Reload to check the current draft and sharing state."};
    return {
      ok: false,
      message:
        error instanceof PlatformError
          ? error.message
          : "The public data could not be saved. Reload and retry.",
    };
  }
}
