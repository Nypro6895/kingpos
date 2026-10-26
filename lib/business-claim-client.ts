import type { BusinessClaimInput, BusinessClaimMatch } from './business-claims';

export async function findBusinessClaimMatches(input: BusinessClaimInput, signal: AbortSignal): Promise<{ matches: BusinessClaimMatch[]; error: string | null }> {
  const fallback = { matches: [], error: 'Could not check existing salons. Please try again.' };
  try {
    const params = new URLSearchParams(input);
    const response = await fetch(`/api/business-claims/matches?${params}`, { signal, cache: 'no-store', credentials: 'same-origin' });
    const result = await response.json();
    if (result && typeof result.error === 'string') return { matches: [], error: result.error };
    if (!response.ok || !Array.isArray(result?.matches) || result.error !== null) return fallback;
    return { matches: result.matches, error: null };
  } catch {
    return fallback;
  }
}
