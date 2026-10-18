import { fetchBoundedGet } from "./bounded-get";
import { ExperienceResourceAccessError, type ExperienceResourceFetcher } from "./experience-resource-cache";

/** Only authorized read DTOs; never credentials, commands or durable POS work. */
export function fetchWorkspaceResource<T extends object>(url: string, scope: string): ExperienceResourceFetcher<T> {
  return async ({ signal, etag, cached }) => {
    const query = new URLSearchParams({ scope });
    const response = await fetchBoundedGet(`${url}${url.includes("?") ? "&" : "?"}${query}`, {
      signal, cache: "no-store", credentials: "same-origin",
      headers: etag ? { "If-None-Match": etag } : {},
    }, { timeoutMs: 8_000, totalTimeoutMs: 8_000, maxAttempts: 1 });
    if ([401, 403, 409].includes(response.status)) throw new ExperienceResourceAccessError(response.status);
    if (response.status === 304 && cached) return { notModified: true };
    if (!response.ok) throw new Error("The view could not update. Your previous data is retained.");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid workspace response.");
    return { data: data as T, etag: response.headers.get("etag") ?? undefined };
  };
}
