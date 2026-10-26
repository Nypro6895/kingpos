"use client";
/* eslint-disable @next/next/no-img-element -- Local package images have no network image optimizer. */
import { createContext, useContext, useMemo, type AnchorHTMLAttributes, type FormHTMLAttributes, type ImgHTMLAttributes, type ReactNode } from "react";
import { appLocalPath } from "@/lib/app-local-host";
type Navigation = { path: string; navigate(path: string, replace?: boolean): void; refresh(): void };
const Context = createContext<Navigation>({ path: "/help", navigate() {}, refresh() {} });
export function AppLocalNavigationProvider({ value, children }: { value: Navigation; children: ReactNode }) { return <Context.Provider value={value}>{children}</Context.Provider>; }
export function usePathname() { return new URL(useContext(Context).path, "https://reylumi.com").pathname; }
export function useSearchParams() { const { path } = useContext(Context); return useMemo(() => new URL(path, "https://reylumi.com").searchParams, [path]); }
export function useLinkStatus() { return { pending: false }; }
export function useRouter() { const current = useContext(Context); return useMemo(() => ({ push: (path: string) => current.navigate(appLocalPath(path)), replace: (path: string) => current.navigate(appLocalPath(path), true), back: () => history.back(), forward: () => history.forward(), refresh: current.refresh, prefetch: () => Promise.resolve() }), [current]); }
export function useParams() { return {}; }
export function useSelectedLayoutSegment() { return usePathname().split("/").filter(Boolean).at(-1) ?? null; }
export function useSelectedLayoutSegments() { return usePathname().split("/").filter(Boolean); }
export function redirect(path: string): never { window.dispatchEvent(new CustomEvent("reylumi:app-local-navigate", { detail: { path: appLocalPath(path) } })); throw new Error("Opening page"); }
export function notFound(): never { throw new Error("This page is unavailable."); }
export function AppLocalLink({ href, children, onClick, replace, prefetch: _prefetch, scroll: _scroll, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string; query?: Record<string, string> }; replace?: boolean; prefetch?: boolean | null; scroll?: boolean }) {
  void [_prefetch, _scroll];
  const router = useRouter();
  const path = typeof href === "string" ? href : (href.pathname ?? "/") + (href.query ? "?" + new URLSearchParams(href.query) : "");
  return <a {...props} href={path} onClick={event => { onClick?.(event); if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download || !path.startsWith("/") || path.startsWith("//")) return; event.preventDefault(); (replace ? router.replace : router.push)(path); }}>{children}</a>;
}
export function AppLocalImage({ src, alt, fill, priority: _priority, unoptimized: _unoptimized, quality: _quality, loader: _loader, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string }; alt: string; fill?: boolean; priority?: boolean; unoptimized?: boolean; quality?: number; loader?: unknown }) {
  void [_priority, _unoptimized, _quality, _loader];
  const source = typeof src === "string" ? src : src.src;
  if (!source.startsWith("/") && !/^https:\/\//.test(source) && !/^data:image\//.test(source)) return null;
  // Public reference assets retain their original local paths in the package.
  return <img {...props} alt={alt} src={source} style={fill ? { position: "absolute", inset: 0, height: "100%", width: "100%", ...props.style } : props.style} />;
}
export function AppLocalForm({ action, onSubmit, replace, prefetch: _prefetch, scroll: _scroll, ...props }: FormHTMLAttributes<HTMLFormElement> & { replace?: boolean; prefetch?: boolean | null; scroll?: boolean }) {
  void [_prefetch, _scroll]; const router = useRouter();
  return <form {...props} action={action} onSubmit={event => { onSubmit?.(event); if (event.defaultPrevented || typeof action !== "string" || (props.method ?? "get").toLowerCase() !== "get" || !action.startsWith("/") || action.startsWith("//")) return; event.preventDefault(); const url = new URL(action,"https://reylumi.com"), data = new FormData(event.currentTarget); for (const [key, value] of data) if (typeof value === "string") url.searchParams.append(key,value); (replace ? router.replace : router.push)(url.pathname+url.search); }} />;
}
