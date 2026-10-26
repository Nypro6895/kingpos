import { randomInt, randomUUID } from "node:crypto";
import { createSecurityChallengeImage, SECURITY_CHALLENGE_ALPHABET } from "@/lib/security-challenge-image";
import { getSafetyContext } from "@/lib/abuse-context";
import { abuseHash } from "@/lib/abuse-signals";
import { abuseServiceClient } from "@/lib/abuse-server";


const options = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    const ctx = await getSafetyContext();
    const id = randomUUID();
    const alphabet = SECURITY_CHALLENGE_ALPHABET;
    const answer = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const { data, error } = await abuseServiceClient().rpc("create_abuse_challenge", {
      p_id: id, p_device: ctx.deviceHash, p_ip: ctx.ipHash || null,
      p_answer_hash: abuseHash(`challenge:${id}:${answer}`),
    });
    if (error) throw new Error("Security check is temporarily unavailable.");
    if (!data) return Response.json({ error: "Too many security checks. Please try again later." }, { status: 429, ...options });
    const image = await createSecurityChallengeImage(answer);
    return Response.json({ id, image: `data:image/png;base64,${image.toString("base64")}` }, options);
  } catch {
    return Response.json({ error: "Security check is temporarily unavailable. Please try again later." }, { status: 503, ...options });
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Reload this page before continuing." }, { status: 403, ...options });
  try {
    const input = await request.json();
    if (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/i.test(input.id) || typeof input.answer !== "string" || !/^[a-z0-9]{6}$/i.test(input.answer.trim())) return Response.json({ error: "Enter the six characters shown in the image." }, { status: 400, ...options });
    const ctx = await getSafetyContext();
    const { data, error } = await abuseServiceClient().rpc("verify_abuse_challenge", {
      p_id: input.id, p_device: ctx.deviceHash, p_ip: ctx.ipHash || null,
      p_answer_hash: abuseHash(`challenge:${input.id}:${input.answer.trim().toUpperCase()}`),
    });
    if (error) throw error;
    return Response.json(data ? { ok: true } : { error: "Incorrect or expired check. Try again or request a new image." }, { status: data ? 200 : 400, ...options });
  } catch {
    return Response.json({ error: "Security check is temporarily unavailable. Please try again later." }, { status: 503, ...options });
  }
}
