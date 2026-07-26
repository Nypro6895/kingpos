export const SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE =
  "Authentication is temporarily unavailable because Supabase cannot be reached. Check the Supabase connection and try again.";

type ErrorLike = {
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

function readErrorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? (error as ErrorLike) : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function isSupabaseAuthConnectionError(error: unknown) {
  const errorLike = readErrorLike(error);
  const name = readString(errorLike.name);
  const message = readString(errorLike.message).toLowerCase();
  const status = readStatus(errorLike.status);

  return (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    message === "fetch failed" ||
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("networkerror") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("getaddrinfo")
  );
}

export function getSupabaseAuthErrorResponse(
  error: unknown,
  fallbackMessage: string,
) {
  if (isSupabaseAuthConnectionError(error)) {
    return {
      message: SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE,
      status: 503,
    };
  }

  const errorLike = readErrorLike(error);
  const message = readString(errorLike.message) || fallbackMessage;
  const status = readStatus(errorLike.status);

  return {
    message,
    status: status && status >= 400 && status < 500 ? status : 400,
  };
}
