"use server";
import { after } from "next/server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { withSettingsTarget } from "@/lib/settings-target-context";


import { validateServiceConfig } from "@/lib/service-contract";
import { saveServiceConfigurations } from "@/lib/services";
import type {
  SaveServiceConfigsResult,
  ServiceConfigInput,
} from "@/types/service";
import { revalidatePath } from "next/cache";
import { getCurrentBusinessContext } from "@/lib/current-context";

function failedServiceResult(
  inputs: ServiceConfigInput[],
  message: string,
): SaveServiceConfigsResult {
  const serviceErrors = Object.fromEntries(
    inputs
      .map((input) => input.serviceId)
      .filter((serviceId): serviceId is string => Boolean(serviceId))
      .map((serviceId) => [serviceId, message]),
  );

  return {
    message,
    ok: false,
    ...(Object.keys(serviceErrors).length > 0 ? { serviceErrors } : {}),
  };
}

function revalidateServiceConsumers(salonId: string) {
  after(()=>broadcastPosStaffChange(salonId,"catalog"));
  revalidatePath("/services");
  revalidatePath("/bookings");
  revalidatePath("/salon-profile");
  revalidatePath("/explore");
  revalidatePath(`/book/${salonId}`);
}

export async function saveServiceConfigsAction(
  inputs: ServiceConfigInput[],
  expectedSalonId?: string,
): Promise<SaveServiceConfigsResult> {
 return withSettingsTarget(expectedSalonId, async () => {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 100) {
    return {
      message: "Choose between 1 and 100 service drafts to save.",
      ok: false,
    };
  }

  for (const input of inputs) {
    const validation = validateServiceConfig(input);

    if (!validation.valid) {
      return failedServiceResult(
        inputs,
        Object.values(validation.fieldErrors)[0] ??
          "Review the highlighted service fields.",
      );
    }
  }

  try {
    if (expectedSalonId && (await getCurrentBusinessContext()).salonId !== expectedSalonId) throw new Error("The selected salon changed. Reload services before saving.");
    const result = await saveServiceConfigurations(inputs);
    revalidateServiceConsumers(result.salonId);

    return {
      message:
        inputs.length === 1
          ? "Service saved."
          : `${inputs.length} services saved.`,
      ok: true,
      serviceIds: result.serviceIds,
    };
  } catch (error) {
    return failedServiceResult(
      inputs,
      error instanceof Error ? error.message : "Services could not be saved.",
    );
  }

 }, "manage");
}

export async function createServiceAction(
  input: Omit<ServiceConfigInput, "serviceId">,
  expectedSalonId?: string,
): Promise<SaveServiceConfigsResult> {
  return saveServiceConfigsAction([
    {
      ...input,
      onlineBookingEnabled:
        input.isActive && input.onlineBookingEnabled,
      serviceId: null,
    },
  ], expectedSalonId);
}
