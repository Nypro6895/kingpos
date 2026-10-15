import { randomInt, randomUUID } from "node:crypto";
import sharp from "sharp";
import { getSafetyContext } from "@/lib/abuse-context";
import { abuseHash } from "@/lib/abuse-signals";
import { abuseServiceClient } from "@/lib/abuse-server";


const options = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    const ctx = await getSafetyContext();
    const id = randomUUID();
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const answer = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const { data, error } = await abuseServiceClient().rpc("create_abuse_challenge", {
      p_id: id, p_device: ctx.deviceHash, p_ip: ctx.ipHash || null,
      p_answer_hash: abuseHash(`challenge:${id}:${answer}`),
    });
    if (error) throw new Error("Security check is temporarily unavailable.");
    if (!data) return Response.json({ error: "Too many security checks. Please try again later." }, { status: 429, ...options });
    const letters = [...answer].map((letter, index) => `<text x="${25 + index * 43}" y="${52 + randomInt(-8, 9)}" transform="rotate(${randomInt(-16, 17)} ${25 + index * 43} 48)" font-family="sans-serif" font-weight="bold" font-size="36" fill="#243953">${letter}</text>`).join("");
    const noise = Array.from({ length: 8 }, () => `<path d="M0 ${randomInt(80)} Q150 ${randomInt(80)} 310 ${randomInt(80)}" stroke="#809ab7" stroke-width="1" fill="none"/>`).join("");
    const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="310" height="80"><rect width="310" height="80" fill="#edf2f7"/>${letters}${noise}</svg>`)).png().toBuffer();
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
