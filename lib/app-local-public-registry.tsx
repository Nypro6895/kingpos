"use client";
import { useEffect } from "react";
import Link from "next/link";
import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import { BeautyProfileReadView } from "@/app/explore/beauty/beauty-profile-read-view";
import { BeautyPostReadView } from "@/app/explore/beauty/beauty-post-read-view";
import { NailInspirationCard } from "@/app/explore/nail-inspiration";
import { PublicBookingClient } from "@/app/book/[salonId]/public-booking-client";
import { getAppLocalHost } from "./app-local-host";
import { useAppLocalResource } from "./app-local-resource";
import { APP_LOCAL_BOOKING_QUERY_KEYS } from "./app-local-public-metadata";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalPublicData } from "./app-local-public-types";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function descriptor(path: string): { name: string; args: Record<string, string>; title: string } | null {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path) || path.length > 4096) return null;
  const url = new URL(path, "https://reylumi.com"), parts = url.pathname.split("/").filter(Boolean); if (url.hash || [...url.searchParams].some(([key, value]) => value.length > 512 || url.searchParams.getAll(key).length !== 1)) return null;
  if (parts.length === 3 && parts[0] === "explore" && parts[1] === "salons" && uuid.test(parts[2]) && !url.search) return { name: "public.salon", args: { salonId: parts[2] }, title: "Salon" };
  if (parts.length === 3 && parts[0] === "explore" && parts[1] === "beauty" && uuid.test(parts[2]) && [...url.searchParams.keys()].every(key => key === "customerId") && (!url.searchParams.has("customerId") || uuid.test(url.searchParams.get("customerId")!))) return { name: "public.beauty", args: { profileId: parts[2], ...(url.searchParams.has("customerId") ? { customerId: url.searchParams.get("customerId")! } : {}) }, title: "Beauty" };
  if (parts.length === 5 && parts[0] === "explore" && parts[1] === "beauty" && parts[3] === "posts" && uuid.test(parts[2]) && uuid.test(parts[4]) && !url.search) return { name: "public.beauty-post", args: { profileId: parts[2], postId: parts[4] }, title: "Beauty post" };
  if (parts.length === 3 && parts[0] === "explore" && parts[1] === "inspiration" && /^[a-z0-9-]{1,100}$/.test(parts[2]) && [...url.searchParams.keys()].every(key => key === "location")) return { name: "public.inspiration", args: { lookId: parts[2], location: url.searchParams.get("location") ?? "" }, title: "Nail inspiration" };
  if (parts.length === 2 && parts[0] === "book" && uuid.test(parts[1]) && [...url.searchParams.keys()].every(key => (APP_LOCAL_BOOKING_QUERY_KEYS as readonly string[]).includes(key))) { url.searchParams.sort(); return { name: "public.booking", args: { salonId: parts[1], query: url.searchParams.toString() }, title: "Book an appointment" }; }
  return null;
}
function OnlineHandoff({ href, reason }: { href: string; reason: "payment" | "own-salon" }) {
  useEffect(() => { if (getAppLocalHost().isNative) void getAppLocalHost().openOnline(href); else window.location.assign(href); }, [href]);
  return <main className="mx-auto grid max-w-xl gap-4 p-6"><h1>{reason === "payment" ? "Book an appointment" : "Your salon"}</h1><p>{reason === "payment" ? "Opening secure booking and payment…" : "Opening your salon…"}</p><button type="button" onClick={() => void getAppLocalHost().openOnline(href)}>Continue</button></main>;
}
/** Full original views; private relationship and social state stay scoped to the viewer. */
export function AppLocalPublicView({ data }: { data: AppLocalPublicData }) {
  if (data.view === "salon") return <main><SalonProfileView {...data.props} /></main>;
  if (data.view === "beauty") return <BeautyProfileReadView page={data.page} />;
  if (data.view === "beauty-post") return <BeautyPostReadView item={data.item} commentViewer={data.commentViewer} profileId={data.profileId} postId={data.postId} />;
  if (data.view === "booking") return <PublicBookingClient data={data.data} />;
  if (data.view === "online") return <OnlineHandoff href={data.href} reason={data.reason} />;
  const explore = `/explore?${new URLSearchParams({ q: `${data.look.colors[0]} ${data.look.shape} nail ideas`, type: "posts", ...(data.location ? { location: data.location, locationSource: "manual" } : {}) })}`;
  return <main className="mx-auto grid max-w-xl gap-4 px-4 py-6"><Link href={explore} className="w-fit text-sm font-semibold text-brand-teal">← Explore nearby nail ideas</Link><h1 className="text-2xl font-semibold">{data.look.title}</h1><NailInspirationCard look={data.look} salon={data.salon} location={data.location} /><p className="text-sm text-text-secondary">Your saved design stays the same wherever you go. Explore connects it with nail salons in your selected area.</p></main>;
}
function PublicPage({ path, context }: AppLocalPageProps) {
  const entry = descriptor(path)!, resource = useAppLocalResource<AppLocalPublicData>(context?.context.scope, entry.name, entry.args, { enabled: Boolean(context) });
  return resource.data ? <AppLocalPublicView data={resource.data} /> : <main className="mx-auto grid max-w-4xl gap-4 p-6"><h1 className="text-2xl font-semibold">{entry.title}</h1><p role="status">{resource.error ? "Could not open this page. Please try again." : "Opening…"}</p>{resource.error ? <button type="button" onClick={() => void resource.refresh()}>Try again</button> : null}</main>;
}
export function getAppLocalPublicPage(path: string): AppLocalPage | null { try { const entry = descriptor(path); return entry ? { id: entry.name, title: entry.title, requiresContext: false, Component: PublicPage, features: ["original-complete-view", "same-viewer-readmodel", "original-visibility-guards", "existing-online-actions", "live-only-availability", "explicit-https-payment"] } : null; } catch { return null; } }
