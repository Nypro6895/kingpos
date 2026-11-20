import {
  publishedRpc,
  publishedHeaders,
} from "@/lib/market-platform/published-server";
import { publicGroup } from "@/lib/market-platform/published-contract";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ group: string }> },
) {
  const { group } = await params;
  if (!publicGroup(group))
    return Response.json(
      { error: "Unsupported group" },
      { status: 404, headers: publishedHeaders },
    );
  const result = await publishedRpc(request, "published_group", {
    p_group: group,
  });
  return (
    result.response ?? Response.json(result.data, { headers: publishedHeaders })
  );
}
