import { PERSONAL_MORE_GROUPS, OWNER_MORE_GROUPS, ROLE_MORE_ITEMS, type RoleMoreItem, type RoleNavigationKind } from "@/app/role-navigation";

export type RoleMoreGroup = { id: string; title: string; summary: string; items: RoleMoreItem[] };

/** Presentation order only: destinations and role membership come from role-navigation. */
export function roleMoreGroups(kind: RoleNavigationKind): RoleMoreGroup[] {
  const definitions = kind === "owner" ? OWNER_MORE_GROUPS : kind === "staff" ? [
    { id: "work", title: "My work", summary: "Review your pay and performance.", ids: ["staff-payroll", "staff-statistics"] },
    { id: "saved", title: "Saved & following", summary: "Saved posts and followed profiles.", ids: ["staff-saved-post", "staff-following"] },
    { id: "support", title: "Workspace & support", summary: "Switch workplaces and get help.", ids: ["staff-my-place", "staff-help", "staff-support"] },
  ] : PERSONAL_MORE_GROUPS;
  const items = ROLE_MORE_ITEMS[kind];
  const used = new Set<string>();
  const groups = definitions.map(group => ({
    id: group.id, title: group.title, summary: group.summary,
    items: group.ids.flatMap(id => {
      const item = items.find(candidate => candidate.id === id);
      if (!item || used.has(id)) return [];
      used.add(id);
      return [item];
    }),
  })).filter(group => group.items.length);
  const remaining = items.filter(item => !used.has(item.id));
  if (remaining.length) groups.push({ id: "other", title: "More tools", summary: "Additional tools for your workspace.", items: remaining });
  return groups;
}
