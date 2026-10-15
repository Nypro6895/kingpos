export type AuthResponse = {
  error?: string;
  code?: "security_check_required" | "rate_limited" | "restricted" | "security_unavailable";
  challengeRequired?: boolean;
  message?: string;
  mfa?: {
    challengeId: string;
    expiresAt: number | null;
    factorId: string;
    factorType: "phone" | "totp";
    phone: string | null;
  };
  redirectTo?: string;
};

export async function readAuthResponse(response: Response, fallbackError: string): Promise<AuthResponse> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as AuthResponse;
    } catch {
      return { error: fallbackError };
    }
  }

  return {
    error: fallbackError,
  };
}
