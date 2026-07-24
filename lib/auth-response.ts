export type AuthResponse = {
  error?: string;
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
