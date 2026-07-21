import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BookingDomainError,
  bookingFailureFromUnknown,
  bookingOk,
  type BookingDomainResult,
} from "@/lib/booking-domain/errors";
import type {
  BookingCustomerResolution,
  BookingCustomerResolutionInput,
} from "@/lib/booking-domain/types";
import type { BookingSource } from "@/types/booking";
import type { Customer } from "@/types/customer";

type PublicUserContact = {
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  id: string;
  last_name: string | null;
  phone: string | null;
  status: string;
};

const CUSTOMER_SELECT =
  "id, location_id, customer_user_id, name, phone, email, notes, staff_notes, internal_notes, source, status, created_by_user_id, updated_by_user_id, created_at, updated_at";

export function normalizeBookingEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function normalizeBookingPhone(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/[^0-9]/g, "");

  if (!digits) {
    return null;
  }

  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function customerDisplayName(input: {
  email: string | null;
  name: string | null | undefined;
  phone: string | null;
  user: PublicUserContact | null;
}) {
  const explicitName = input.name?.trim();

  if (explicitName) {
    return explicitName;
  }

  const userName =
    input.user?.display_name?.trim() ||
    [input.user?.first_name, input.user?.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");

  return userName || input.email || input.phone || "Guest Customer";
}

async function loadCustomerById(
  supabase: SupabaseClient,
  salonId: string,
  customerId: string,
) {
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("id", customerId)
    .eq("location_id", salonId)
    .maybeSingle<Customer>();

  if (error) {
    throw new BookingDomainError("database_error", error.message);
  }

  return data;
}

async function loadPublicUser(
  supabase: SupabaseClient,
  customerUserId: string | null | undefined,
) {
  if (!customerUserId) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, phone, first_name, last_name, display_name, status")
    .eq("id", customerUserId)
    .neq("status", "deleted")
    .maybeSingle<PublicUserContact>();

  if (error) {
    throw new BookingDomainError("database_error", error.message);
  }

  if (!data) {
    throw new BookingDomainError(
      "relationship_invalid",
      "Customer account was not found.",
      { field: "customerUserId" },
    );
  }

  return data;
}

async function loadCustomerByContact(input: {
  field: "email" | "phone";
  salonId: string;
  supabase: SupabaseClient;
  value: string | null;
}) {
  if (!input.value) {
    return null;
  }

  const { data, error } = await input.supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", input.salonId)
    .eq(input.field, input.value)
    .limit(2)
    .returns<Customer[]>();

  if (error) {
    throw new BookingDomainError("database_error", error.message);
  }

  if ((data ?? []).length > 1) {
    throw new BookingDomainError(
      "conflict",
      `Multiple customers matched the same ${input.field}.`,
      { field: input.field },
    );
  }

  return data?.[0] ?? null;
}

export async function resolveBookingCustomer(input: {
  actorUserId?: string | null;
  bookingSource?: BookingSource;
  customer: BookingCustomerResolutionInput;
  salonId: string;
  supabase: SupabaseClient;
}): Promise<BookingDomainResult<BookingCustomerResolution>> {
  try {
    if (input.customer.customerId) {
      const customer = await loadCustomerById(
        input.supabase,
        input.salonId,
        input.customer.customerId,
      );

      if (!customer) {
        throw new BookingDomainError(
          "relationship_invalid",
          "Customer must belong to this salon.",
          { field: "customerId" },
        );
      }

      return bookingOk({
        created: false,
        customer,
        customerUserId: input.customer.customerUserId ?? null,
        matchedBy: "customer_id",
      });
    }

    const user = await loadPublicUser(
      input.supabase,
      input.customer.customerUserId,
    );
    const normalizedPhone = normalizeBookingPhone(
      input.customer.phone ?? user?.phone,
    );
    const normalizedEmail = normalizeBookingEmail(
      input.customer.email ?? user?.email,
    );
    const phoneMatch = await loadCustomerByContact({
      field: "phone",
      salonId: input.salonId,
      supabase: input.supabase,
      value: normalizedPhone,
    });
    const emailMatch = await loadCustomerByContact({
      field: "email",
      salonId: input.salonId,
      supabase: input.supabase,
      value: normalizedEmail,
    });

    if (phoneMatch && emailMatch && phoneMatch.id !== emailMatch.id) {
      throw new BookingDomainError(
        "conflict",
        "Phone and email match different customer records.",
      );
    }

    const matchedCustomer = phoneMatch ?? emailMatch;

    if (matchedCustomer) {
      if (
        user?.id &&
        matchedCustomer.customer_user_id &&
        matchedCustomer.customer_user_id !== user.id
      ) {
        throw new BookingDomainError(
          "conflict",
          "Matched customer is already linked to another account.",
          { field: "customerUserId" },
        );
      }

      if (user?.id && !matchedCustomer.customer_user_id) {
        const { data: linkedCustomer, error: linkError } = await input.supabase
          .from("customers")
          .update({
            customer_user_id: user.id,
            source:
              matchedCustomer.source === "manual"
                ? "account_link"
                : matchedCustomer.source,
            updated_by_user_id: input.actorUserId ?? matchedCustomer.updated_by_user_id,
          })
          .eq("id", matchedCustomer.id)
          .eq("location_id", input.salonId)
          .is("customer_user_id", null)
          .select(CUSTOMER_SELECT)
          .single<Customer>();

        if (linkError || !linkedCustomer) {
          throw new BookingDomainError(
            "database_error",
            linkError?.message ?? "Unable to link customer account.",
          );
        }

        return bookingOk({
          created: false,
          customer: linkedCustomer,
          customerUserId: user.id,
          matchedBy: "customer_user",
        });
      }

      return bookingOk({
        created: false,
        customer: matchedCustomer,
        customerUserId: user?.id ?? input.customer.customerUserId ?? null,
        matchedBy: phoneMatch ? "phone" : "email",
      });
    }

    const name = customerDisplayName({
      email: normalizedEmail,
      name: input.customer.name,
      phone: normalizedPhone,
      user,
    });
    const { data: createdCustomer, error: createError } = await input.supabase
      .from("customers")
      .insert({
        created_by_user_id: input.actorUserId ?? null,
        customer_user_id: user?.id ?? null,
        email: normalizedEmail,
        location_id: input.salonId,
        name,
        phone: normalizedPhone,
        source: user
          ? "account_link"
          : input.bookingSource === "public_profile" ||
              input.bookingSource === "explore"
            ? "public_booking"
            : input.bookingSource === "pos"
              ? "pos"
              : "owner_booking",
        status: "active",
        updated_by_user_id: input.actorUserId ?? null,
      })
      .select(CUSTOMER_SELECT)
      .single<Customer>();

    if (createError || !createdCustomer) {
      throw new BookingDomainError(
        "database_error",
        createError?.message ?? "Unable to create customer.",
      );
    }

    return bookingOk({
      created: true,
      customer: createdCustomer,
      customerUserId: user?.id ?? input.customer.customerUserId ?? null,
      matchedBy: user ? "customer_user" : "created",
    });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}
