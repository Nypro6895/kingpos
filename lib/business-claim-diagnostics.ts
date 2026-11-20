import 'server-only';

type LookupPhase = 'suggestions' | 'create';
type ErrorFields = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; cause?: unknown };

const codeMessages: Record<string, string> = {
  '57014': 'Database query canceled',
  '55P03': 'Database lock unavailable',
  '42501': 'Database permission denied',
  '42P01': 'Database relation missing',
  '42703': 'Database column missing',
  '42883': 'Database function missing',
  '08006': 'Database connection failure',
  PGRST000: 'PostgREST database connection failure',
  PGRST001: 'PostgREST database connection failure',
  PGRST002: 'PostgREST schema cache unavailable',
  PGRST003: 'PostgREST connection pool timeout',
  PGRST202: 'RPC signature missing from schema cache',
  PGRST203: 'RPC signature is ambiguous',
  PGRST301: 'JWT verification failed',
  PGRST302: 'Authentication required',
  PGRST303: 'JWT claims validation failed',
};
const safeMessages = new Set([
  'canceling statement due to statement timeout',
  'canceling statement due to user request',
  'canceling statement due to lock timeout',
  'fetch failed',
  'TypeError: fetch failed',
  'Failed to fetch',
]);

function fields(error: unknown): ErrorFields {
  return error && typeof error === 'object' ? error as ErrorFields : {};
}

function technicalCode(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[0-9]{2}[0-9A-Z]{3}|P[0-9]{4}|XX[0-9]{3}|PGRST[0-9]{3}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT)$/.test(value)
    ? value : null;
}

function logFailure(error: unknown, phase: LookupPhase, startedAt: number, status?: number) {
  const value = fields(error);
  const code = technicalCode(value.code) ?? technicalCode(fields(value.cause).code) ?? 'unknown';
  // Database messages/details may echo user input, row values, URLs or credentials.
  // Emit only fixed technical text; never serialize the error, request or stack.
  const message = typeof value.message === 'string' && safeMessages.has(value.message)
    ? value.message : codeMessages[code] ?? 'Lookup failed; unrecognized message omitted';
  console.error('Business claim lookup failed', {
    rpc: 'find_business_claim_matches',
    phase,
    code,
    message,
    details: {
      httpStatus: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      detailsOmitted: value.details != null && value.details !== '',
      hintOmitted: value.hint != null && value.hint !== '',
    },
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
}

export async function withBusinessClaimLookupDiagnostics<T extends { error: unknown; status?: number }>(
  phase: LookupPhase,
  lookup: () => PromiseLike<T>,
): Promise<T> {
  const startedAt = performance.now();
  let result: T;
  try {
    result = await lookup();
  } catch (error) {
    logFailure(error, phase, startedAt);
    throw error;
  }
  if (result.error) logFailure(result.error, phase, startedAt, result.status);
  return result;
}
