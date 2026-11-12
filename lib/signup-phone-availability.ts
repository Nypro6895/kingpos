import "server-only";
import { abuseServiceClient } from "@/lib/abuse-server";

// Only the server may query availability; never return another account's identity.
export async function isSignupPhoneAvailable(phone: string): Promise<boolean> {
  const { data, error } = await abuseServiceClient().rpc("signup_phone_available", {
    p_phone: phone,
  });
  if (error || typeof data !== "boolean") {
    throw new Error("Phone numbers could not be checked. Please try again later.");
  }
  return data;
}
