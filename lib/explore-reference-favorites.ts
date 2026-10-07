import "server-only";
import { wisconsinBusinesses } from "@/lib/wisconsin-directory";
import { getExploreShowcaseLookPage } from "@/lib/explore-showcase-content";
export function referenceFavorite(key: string) {
  if (key.startsWith("salon:showcase-")) {
    const id = key.slice(6);
    for (let rank = 1; rank <= 20; rank++) {
      const look = getExploreShowcaseLookPage(`showcase-look-${rank}`);
      if (
        look &&
        (id === `showcase-${rank}` ||
          id ===
            `showcase-${look.salonName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)
      )
        return { key, name: look.salonName, href: `/explore/looks/${look.id}` };
    }
  }
  if (key.startsWith("directory:")) {
    const id = key.slice(10);
    const business = wisconsinBusinesses.find((item) => item.id === id);
    return business
      ? { key, name: business.name, href: `/explore/wisconsin/${id}` }
      : null;
  }
  if (key.startsWith("look:")) {
    const id = key.slice(5);
    const look = getExploreShowcaseLookPage(id);
    return look
      ? {
          key,
          name: `${look.service} · ${look.salonName}`,
          href: `/explore/looks/${look.id}`,
        }
      : null;
  }
  return null;
}
