import { createAuthenticatedSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentKingUser } from '@/lib/users/current-user';
import { withBusinessClaimLookupDiagnostics } from '@/lib/business-claim-diagnostics';

const failure = 'Could not check existing salons. Please try again.';
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

// Suggestions are a read. A Server Action POST triggers workspace mutation
// validation and can reset the form before its result is displayed.
export async function GET(request: Request) {
  try {
    const [user, client] = await Promise.all([
      getCurrentKingUser(), createAuthenticatedSupabaseServerClient(),
    ]);
    if (!user || user.status !== 'active' || !client) {
      return json({ matches: [], error: 'Please sign in with an active account.' }, 401);
    }
    const params = new URL(request.url).searchParams;
    const value = (key: string, max: number) => (params.get(key) ?? '').slice(0, max);
    const { data, error } = await withBusinessClaimLookupDiagnostics('suggestions', () => client.rpc('find_business_claim_matches', {
      p_name: value('name', 160), p_phone: value('phone', 40), p_address: value('address', 250),
      p_unit: value('unit', 100), p_city: value('city', 100), p_state: value('state', 100),
    }));
    if (error) return json({ matches: [], error: failure }, 503);
    return json({ matches: data ?? [], error: null });
  } catch {
    return json({ matches: [], error: failure }, 503);
  }
}
