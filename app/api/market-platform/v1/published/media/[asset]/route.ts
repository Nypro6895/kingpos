import {
  publishedRpc,
  publishedHeaders,
} from "@/lib/market-platform/published-server";
import {
  sanitizedPublicImage,
  boundedImageBody,
} from "@/lib/market-platform/published-image";
import { syntheticImageId, syntheticImage } from "@/lib/market-platform/synthetic-image";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      asset,
    )
  )
    return Response.json(
      { error: "Invalid image" },
      { status: 404, headers: publishedHeaders },
    );
  if (asset === syntheticImageId) {
    const test = await publishedRpc(request, "published_group", {p_group:"media"});
    if (test.response) return test.response;
    if (test.data?.synthetic === true && test.data?.data?.images?.some((image: {assetId?:string})=>image.assetId===asset)) {
      return new Response(new Uint8Array(await syntheticImage()), {headers:{...publishedHeaders,"Content-Type":"image/webp"}});
    }
  }
  const result = await publishedRpc(request, "published_media_source", {
    p_asset: asset,
  });
  if (result.response) return result.response;
  const source = result.data as {
    salonId: string;
    assetId: string;
    path: string;
    bucket: string;
  };
  if (
    source.bucket !== "salon-profile-media" ||
    !new RegExp("^" + source.salonId + "/[A-Za-z0-9/_-]+\\.webp$").test(
      source.path,
    )
  )
    return Response.json(
      { error: "Image unavailable" },
      { status: 404, headers: publishedHeaders },
    );
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const url = new URL(
      "/storage/v1/object/public/salon-profile-media/" +
        source.path.split("/").map(encodeURIComponent).join("/"),
      base,
    );
    const fetched = await fetch(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const image = await sanitizedPublicImage(await boundedImageBody(fetched));
    return new Response(new Uint8Array(image), {
      headers: { ...publishedHeaders, "Content-Type": "image/webp" },
    });
  } catch {
    return Response.json(
      { error: "Image unavailable" },
      { status: 503, headers: publishedHeaders },
    );
  }
}
