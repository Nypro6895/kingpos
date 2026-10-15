import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mergeExploreSearchSuggestions, normalizeExploreSuggestionRequest } from "@/lib/explore-search-suggestions";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
  const input = normalizeExploreSuggestionRequest({ query: request.nextUrl.searchParams.get("q"),
    location: request.nextUrl.searchParams.get("location"), category: request.nextUrl.searchParams.get("category") });
  if (input.query.length < 2) return NextResponse.json({ suggestions: [] }, { headers });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 3500);
  try {
    const client = createSupabaseServerClient();
    if (!client) return NextResponse.json({ suggestions: mergeExploreSearchSuggestions([], input) }, { headers });
    const result = await client.rpc("get_public_explore_search_suggestions", {
      p_query: input.query, p_category: input.category || null, p_city: input.city || null, p_state: input.state || null, p_limit: 8,
    }).abortSignal(abort.signal);
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ suggestions: mergeExploreSearchSuggestions(result.error ? [] : result.data, input) }, { headers });
  } catch {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ suggestions: mergeExploreSearchSuggestions([], input) }, { headers });
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel);
  }
}
