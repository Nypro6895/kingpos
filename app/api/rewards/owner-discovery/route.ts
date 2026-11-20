import { marketPluginContext } from "@/lib/market-plugins";
import { getRewardPublicSalonContext } from "@/lib/reward-public-context";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { client, salonId } = await marketPluginContext();
    const { data, error } = await client.rpc("reward_owner_discovery", { p_salon: salonId });
    if (error || !data || typeof data.salonId !== "string") return Response.json({ error: "Rewards could not be loaded." }, { status: 503, headers });
    if (data.enabled) return Response.json(data, { headers });
    // All preview reads stay behind the same current-salon Owner gate. Loading
    // defaults is read-only; this route never activates or saves a program.
    const [program, identity, context] = await Promise.all([
      Promise.resolve(client.rpc("reward_owner", { p_salon: salonId, p_op: "load", p_args: {} })).catch(() => null),
      Promise.resolve(client.from("locations").select("name,city,state").eq("id", salonId).maybeSingle()).catch(() => null),
      getRewardPublicSalonContext(client, salonId).catch(() => null),
    ]);
    const preview = program && !program.error && program.data?.program && identity && !identity.error && identity.data ? {
      ...program.data.program, id: salonId, name: identity.data.name,
      city: identity.data.city, state: identity.data.state, distanceMiles: null,
      version: program.data.version, ...context,
    } : null;
    return Response.json({ ...data, preview }, { headers });
  } catch { return Response.json({ error: "Select your Owner workspace." }, { status: 403, headers }); }
}
