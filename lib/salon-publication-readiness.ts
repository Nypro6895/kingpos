import type { SalonProfileReadiness, SalonProfileLook, SalonProfileSetting } from "@/types/salon-profile";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

// These are two existing entry-point policies for the SAME publication flag.
// Preserve every enforced condition until their business-rule consolidation is approved.
// Public route availability must be read from the server, never inferred from a checklist.
type DiscoverySettingSnapshot = {
  address_line1?: string | null;
  business_description?: string | null;
  business_name?: string | null;
  city?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
};

export type SalonDiscoveryReadinessItem = {
  complete: boolean;
  href: string;
  id: string;
  label: string;
};

export type SalonDiscoveryReadiness = {
  activeServiceCount: number;
  canEnable: boolean;
  items: SalonDiscoveryReadinessItem[];
  missingLabels: string[];
};

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function getLocationLabel(setting: SalonProfileSetting) {
  return [
    setting.address_line1,
    setting.city,
    setting.state,
    setting.postal_code,
  ].filter(hasText);
}

export function getSalonDiscoveryReadiness(input: {
  activeServiceCount: number;
  salonStatus?: string | null;
  setting: DiscoverySettingSnapshot;
}): SalonDiscoveryReadiness {
  const items: SalonDiscoveryReadinessItem[] = [
    {
      complete: input.salonStatus === "active",
      href: "/salons",
      id: "salon-status",
      label: "Active salon location",
    },
    {
      complete: hasText(input.setting.business_name),
      href: "#business-information",
      id: "business-name",
      label: "Public business name",
    },
    {
      complete: hasText(input.setting.phone),
      href: "#business-information",
      id: "phone",
      label: "Public phone",
    },
    {
      complete: hasText(input.setting.address_line1),
      href: "#business-information",
      id: "address",
      label: "Street address",
    },
    {
      complete: hasText(input.setting.city),
      href: "#business-information",
      id: "city",
      label: "City",
    },
    {
      complete: hasText(input.setting.state),
      href: "#business-information",
      id: "state",
      label: "State",
    },
    {
      complete: hasText(input.setting.postal_code),
      href: "#business-information",
      id: "postal-code",
      label: "ZIP code",
    },
    {
      complete: hasText(input.setting.business_description),
      href: "#business-information",
      id: "description",
      label: "Public description",
    },
    {
      complete: input.activeServiceCount > 0,
      href: "/services",
      id: "active-service",
      label: "At least one active service",
    },
  ];
  const missingLabels = items
    .filter((item) => !item.complete)
    .map((item) => item.label);

  return {
    activeServiceCount: input.activeServiceCount,
    canEnable: missingLabels.length === 0,
    items,
    missingLabels,
  };
}

export function getSalonProfileReadiness(input: {
  looks: SalonProfileLook[];
  publishedLookCount?: number;
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
}): SalonProfileReadiness {
  const publishedLookCount = input.publishedLookCount ?? input.looks.filter(
    (look) => look.status === "published",
  ).length;
  const activeServiceCount = input.services.filter(
    (service) => service.is_active,
  ).length;
  const activeStaffCount = input.staff.filter((member) => member.is_active).length;
  const requiredItems = [
    {
      complete: hasText(input.setting.business_name),
      id: "business-name",
      label: "Public business name",
      required: true,
    },
    {
      complete: hasText(input.setting.public_profile_tagline),
      id: "tagline",
      label: "Tagline",
      required: true,
    },
    {
      complete: hasText(input.setting.public_profile_logo_path),
      id: "logo",
      label: "Logo",
      required: true,
    },
    {
      complete: hasText(input.setting.public_profile_cover_path),
      id: "cover",
      label: "Cover image",
      required: true,
    },
    {
      complete: getLocationLabel(input.setting).length >= 4 && hasText(input.setting.phone),
      id: "location-contact",
      label: "Valid location and contact",
      required: true,
    },
    {
      complete: activeServiceCount > 0,
      id: "active-service",
      label: "At least one active service",
      required: true,
    },
    {
      complete: publishedLookCount > 0,
      id: "published-look",
      label: "At least one published look",
      required: true,
    },
  ];
  const optionalItems = [
    {
      complete: hasText(input.setting.public_profile_story),
      id: "story",
      label: "Salon story",
      required: false,
    },
    {
      complete: hasText(input.setting.website),
      id: "website",
      label: "Website",
      required: false,
    },
    {
      complete: publishedLookCount >= 3,
      id: "three-looks",
      label: "Three or more published looks",
      required: false,
    },
    {
      complete: activeStaffCount > 0,
      id: "team",
      label: "Active team members",
      required: false,
    },
  ];
  const items = [...requiredItems, ...optionalItems];
  const completedCount = items.filter((item) => item.complete).length;
  const missingRequiredItems = requiredItems
    .filter((item) => item.required && !item.complete)
    .map((item) => item.label);
  const canPublish = missingRequiredItems.length === 0;
  const isPublished = input.setting.public_discovery_enabled && canPublish;

  return {
    canPublish,
    completionPercent: Math.round((completedCount / items.length) * 100),
    isExploreEligible: isPublished,
    items,
    missingRequiredItems,
    status: isPublished
      ? "published"
      : canPublish
        ? "ready"
        : hasText(input.setting.business_name)
          ? "draft"
          : "incomplete",
  };
}

