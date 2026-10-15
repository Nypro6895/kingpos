import type { CurrentBusinessContext } from "@/lib/current-context";
import type { PostCommentViewer } from "@/types/post-comments";

export function exploreCommentIdentity(context: CurrentBusinessContext): NonNullable<PostCommentViewer["identity"]> {
  const user = context.user;
  const name = user?.display_name?.trim() || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Guest";
  const salon = context.salonMode === "staff" ? context.currentStaffSalon : context.currentSalon;
  if (user && context.workspaceType === "salon" && salon) {
    if (context.salonMode === "staff") return { name, role: "staff", salonId: salon.id, avatarUrl: user.avatar_url };
    if ([...context.permissions, ...context.permissionCodes].some(code => ["salon_profile.manage", "salon_profile.content.manage"].includes(code))) return { name: salon.name, role: "salon", salonId: salon.id, avatarUrl: context.currentWorkspace?.avatarUrl ?? null };
  }
  return { name, role: "personal", salonId: null, avatarUrl: user?.avatar_url ?? null };
}
export function commentIdentityKey(identity: NonNullable<PostCommentViewer["identity"]>) { return `${identity.role}:${identity.salonId ?? "personal"}`; }
