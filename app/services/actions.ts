"use server";

import { validateServiceConfig } from "@/lib/service-contract";
import { saveServiceConfigurations } from "@/lib/services";
import type {
  SaveServiceConfigsResult,
  ServiceConfigInput,
} from "@/types/service";
import { revalidatePath } from "next/cache";

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
  revalidatePath("/services");
  revalidatePath("/bookings");
  revalidatePath("/salon-profile");
  revalidatePath("/explore");
  revalidatePath(`/book/${salonId}`);
}

export async function saveServiceConfigsAction(
  inputs: ServiceConfigInput[],
): Promise<SaveServiceConfigsResult> {
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
}

export async function createServiceAction(
  input: Omit<ServiceConfigInput, "serviceId">,
): Promise<SaveServiceConfigsResult> {
  return saveServiceConfigsAction([
    {
      ...input,
      onlineBookingEnabled:
        input.isActive && input.onlineBookingEnabled,
      serviceId: null,
    },
  ]);
}
