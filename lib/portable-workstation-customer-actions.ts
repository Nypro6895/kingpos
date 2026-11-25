import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGiftDisplayAppearance } from "@/lib/gift-display-appearance";
import { issueServiceRelayPass } from "@/app/service-relay/actions";
import { isSameOriginMutation } from "@/lib/request-origin";

const giftOperations = new Set(["read", "appearance", "open", "dismiss", "cancel", "scan", "code", "buy", "amount"]);
const rewardOperations = new Set(["load", "request", "confirm", "cancel"]);

/** Called only after fresh enrollment authorization. Never accepts a display bearer from the browser. */
export async function runPairedCustomerExtension(command: string, input: Record<string, unknown>, token: string, request?: Request): Promise<{handled: boolean; value?: unknown}> {
  if (!["gift", "rewards", "relay.entry", "relay.pass"].includes(command)) return {handled:false};
  if (request && !isSameOriginMutation(request)) throw new Error("Invalid customer request origin.");
  const client = createSupabaseServerClient();
  if (!client) throw new Error("This customer screen is temporarily unavailable.");
  if (command === "relay.pass") {
    if (typeof input.visitId !== "string" || !/^[a-f\d-]{36}$/i.test(input.visitId)) throw new Error("Choose a current visit.");
    return {handled:true,value:await issueServiceRelayPass(token,input.visitId)};
  }
  if (command === "relay.entry") {
    const reply = await client.rpc("personal_checkin_entry", {p_token:token});
    if (reply.error) throw new Error(reply.error.message);
    return {handled:true,value:{entry:reply.data ?? null}};
  }
  const op = input.op;
  if (typeof op !== "string" || !(command === "gift" ? giftOperations : rewardOperations).has(op)) throw new Error("This action is not available on the customer screen.");
  const args = input.args;
  if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 32_000)) throw new Error("Invalid customer request.");
  if (command === "gift" && op === "appearance") return {handled:true,value:await getGiftDisplayAppearance(client,token)};
  // Existing display RPCs retain their customer consent, receipt identity,
  // revision, gift balance and visit ownership checks. No POS/Owner branch.
  const reply = await client.rpc(command === "gift" ? "gift_card_display" : "reward_display", {p_token:token,p_op:op,p_args:args ?? {}});
  if (reply.error) throw new Error(reply.error.message);
  return {handled:true,value:reply.data ?? {}};
}
