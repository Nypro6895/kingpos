type SupabaseErrorLike = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

function readErrorLike(error: unknown): SupabaseErrorLike {
  return error && typeof error === "object" ? (error as SupabaseErrorLike) : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function isMissingSupabaseColumnError(
  error: unknown,
  columnName?: string,
) {
  const errorLike = readErrorLike(error);
  const code = readString(errorLike.code);
  const haystack = [
    errorLike.message,
    errorLike.details,
    errorLike.hint,
  ]
    .map(readString)
    .join(" ")
    .toLowerCase();

  if (columnName && !haystack.includes(columnName.toLowerCase())) {
    return false;
  }

  return (
    code === "42703" ||
    code === "PGRST204" ||
    haystack.includes("does not exist") ||
    haystack.includes("could not find") ||
    haystack.includes("schema cache")
  );
}
