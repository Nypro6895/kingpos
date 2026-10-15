import { DEFAULT_BUSINESS_IMAGES } from "@/lib/default-nail-images";
import { selectNailLooks, supportsNailInspiration } from "@/lib/nail-inspiration";

export type ExploreEditorialReference = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  href: string;
  kind: "inspiration" | "guide";
};

/** Reference content is separate from local salon results and never implies availability. */
export function exploreEditorialHref(category: string, location: string, query = "", target: "auto" | "salons" = "auto") {
  const params = new URLSearchParams({ category: category || "All" });
  if (location.trim()) params.set("location", location.trim());
  if (query) params.set("q", query);
  if (target !== "auto") params.set("type", target);
  return `/explore?${params}`;
}

const guides: Record<string, Array<[string, string, string]>> = {
  Nails: [["Find your everyday manicure", "Explore shapes, finishes and services for your next set.", "Manicure"], ["Make time for a pedicure", "Discover salons and compare their service menus.", "Pedicure"], ["Try a little nail art", "Bring an idea and discuss the details with your nail artist.", "Nail art"]],
  Hair: [["A fresh cut", "Explore hair salons and find a stylist for your next cut.", "Haircut"], ["A new shade", "Browse color services and discuss your inspiration with a stylist.", "Hair color"], ["Your next style", "Find a salon and explore the services on its profile.", "Hair styling"]],
  Lashes: [["Find your lash style", "Explore lash services and discuss your preferred look.", "Lashes"], ["Plan your next appointment", "Compare salon profiles and contact a lash artist.", ""]],
  Massage: [["Make space to unwind", "Explore massage providers and their service menus.", "Massage"], ["Find your next session", "Contact a provider to discuss your preferences and times.", ""]],
  Spa: [["A moment for yourself", "Explore spa services for your next self-care visit.", "Spa"], ["Discover a local retreat", "Browse profiles and contact a spa to plan your visit.", ""]],
  Tattoo: [["Start with an idea", "Explore artists and discuss your design before booking.", "Tattoo"], ["Find your artist", "Browse studio profiles and ask about a consultation.", ""]],
  Brows: [["Frame your look", "Explore brow services and talk through your preferred shape.", "Brows"], ["Meet your next brow artist", "Browse profiles and compare service menus.", ""]],
  Waxing: [["Plan your next visit", "Explore waxing services and compare salon profiles.", "Waxing"], ["Find the right service", "Contact a salon to discuss your preferences.", ""]],
  "Skin Care": [["Make time for skin care", "Explore facials and discuss your preferences with a provider.", "Facial"], ["Discover your next appointment", "Browse skin care providers and their service menus.", ""]],
};

export function exploreServiceGuides(category: string, location: string): ExploreEditorialReference[] {
  const selected = Object.keys(guides).find(key => key.toLowerCase() === category.toLowerCase());
  const categories = selected ? [selected] : !category || category.toLowerCase() === "all" ? ["Nails", "Hair", "Spa"] : [category];
  return categories.flatMap(key => {
    const entries = guides[key] ?? [[`Explore ${key.toLowerCase()}`, "Browse profiles and discuss services with a local provider.", ""]];
    const images = DEFAULT_BUSINESS_IMAGES[key as keyof typeof DEFAULT_BUSINESS_IMAGES];
    return (categories.length > 1 ? entries.slice(0, 1) : entries).map(([title, description, query], index) => ({
      id: `guide:${key}:${index}`, title, description, imageUrl: images?.[index % images.length] ?? "",
      href: exploreEditorialHref(key, location, query), kind: "guide" as const,
    }));
  });
}

export function exploreEditorialReferences(category: string, location: string, count: number, excludedImages: string[] = []): ExploreEditorialReference[] {
  if (count <= 0) return [];
  if (!supportsNailInspiration(category)) return exploreServiceGuides(category, location).slice(0, count);
  const excluded = new Set(excludedImages);
  return selectNailLooks("", {}, "explore-editorial").filter(look => !excluded.has(look.imageUrl)).slice(0, count).map(look => ({
    id: `reference:${look.id}`, title: look.title,
    description: `${look.length} · ${look.shape} · ${look.finish}`,
    imageUrl: look.imageUrl,
    href: exploreEditorialHref("Nails", location, `${look.colors[0]} ${look.shape} nails`),
    kind: "inspiration" as const,
  }));
}
