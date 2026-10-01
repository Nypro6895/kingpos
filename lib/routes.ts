type RouteSearchParams = Record<
  string,
  string | string[] | number | boolean | null | undefined
>;

export const routes = {
  salons: {
    create: () => "/salons/new",
    list: () => "/salons",
  },
} as const;

export function withSearchParams(path: string, params: RouteSearchParams) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}
