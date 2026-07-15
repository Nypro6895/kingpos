import "server-only";

import {
  getCurrentBusinessContext,
  getRouteForInvalidSalonContext,
  isOrganizationContext,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { redirect } from "next/navigation";

type AuthenticatedBusinessContext = CurrentBusinessContext & {
  user: NonNullable<CurrentBusinessContext["user"]>;
};

export type SalonManagePageContext = AuthenticatedBusinessContext & {
  currentOrganization: NonNullable<CurrentBusinessContext["currentOrganization"]>;
  currentSalon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  salonMode: "manage";
  workspaceType: "salon";
};

export type SalonStaffPageContext = AuthenticatedBusinessContext & {
  currentOrganization: NonNullable<CurrentBusinessContext["currentOrganization"]>;
  currentSalon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  currentStaffSalon: NonNullable<CurrentBusinessContext["currentStaffSalon"]>;
  salonMode: "staff";
  workspaceType: "salon";
};

export type OrganizationPageContext = AuthenticatedBusinessContext & {
  currentMembership: NonNullable<CurrentBusinessContext["currentMembership"]>;
  currentOrganization: NonNullable<CurrentBusinessContext["currentOrganization"]>;
  workspaceType: "organization";
};

function loginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export async function requireSalonManagePageContext(
  nextPath: string,
): Promise<SalonManagePageContext> {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect(loginRedirect(nextPath));
  }

  if (
    !isSalonManageContext(context) ||
    !context.currentOrganization ||
    !context.currentSalon
  ) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  return context as SalonManagePageContext;
}

export async function requireSalonStaffPageContext(
  nextPath: string,
): Promise<SalonStaffPageContext> {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect(loginRedirect(nextPath));
  }

  if (
    !isSalonStaffContext(context) ||
    !context.currentOrganization ||
    !context.currentSalon ||
    !context.currentStaffSalon
  ) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  return context as SalonStaffPageContext;
}

export async function requireOrganizationPageContext(
  nextPath: string,
): Promise<OrganizationPageContext> {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect(loginRedirect(nextPath));
  }

  if (
    !isOrganizationContext(context) ||
    !context.currentOrganization ||
    !context.currentMembership
  ) {
    redirect("/my-place?error=Choose%20an%20organization%20workspace%20first.");
  }

  return context as OrganizationPageContext;
}
