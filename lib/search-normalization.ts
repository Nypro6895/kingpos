const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const VIETNAMESE_D_PATTERN = /[\u0110\u0111]/g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g;
const WHITESPACE_PATTERN = /\s+/g;

export function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .replace(VIETNAMESE_D_PATTERN, "d")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

export function searchTextMatches(
  values: Array<number | string | null | undefined>,
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return true;
  }

  const haystack = normalizeSearchText(
    values
      .filter((value): value is number | string => value !== null && value !== undefined)
      .join(" "),
  );

  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}
