import { marketPluginContext } from "@/lib/market-plugins";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { client, salonId } = await marketPluginContext();
    const { data, error } = await client.rpc("reward_owner_discovery", { p_salon: salonId });
    if (error) return Response.json({ error: "Rewards could not be loaded." }, { status: 503, headers });
    return Response.json(data, { headers });
  } catch { return Response.json({ error: "Select your Owner workspace." }, { status: 403, headers }); }
}
