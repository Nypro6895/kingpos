export type LiveResourceSnapshot<T extends object> = {
  data: T;
  revision: string;
  sections: Record<string, string>;
  updatedAt: string;
};

export type LiveResourceResponse<T extends object> = Omit<LiveResourceSnapshot<T>, "data"> & {
  data: Partial<T>;
  partial: boolean;
};

// A section is replaced only when the authorized server says it changed. The
// unchanged objects keep their identity and the existing view keeps its controls.
export function mergeLiveResource<T extends object>(
  cached: LiveResourceSnapshot<T> | undefined,
  response: LiveResourceResponse<T>,
): LiveResourceSnapshot<T> {
  if (response.partial && !cached) throw new Error("A complete snapshot is required.");
  return {
    data: (response.partial ? { ...cached!.data, ...response.data } : response.data) as T,
    revision: response.revision,
    sections: response.sections,
    updatedAt: response.updatedAt,
  };
}

export function liveResourceRequestUrl<T extends object>(
  url: string,
  scope: string,
  cached?: LiveResourceSnapshot<T>,
) {
  const query = new URLSearchParams({ scope });
  if (cached) query.set("sections", JSON.stringify(cached.sections));
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
