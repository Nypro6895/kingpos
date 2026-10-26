import "server-only";
import { customerPhoneKey, customerNameKey, customerNameSimilarity } from "@/lib/customer-identity-match";

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
  return customerPhoneKey(value);
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

  if (!data) {
    const { data: alias, error: aliasError } = await supabase.from("customer_merged_ids")
      .select("target_id").eq("source_id", customerId).eq("salon_id", salonId).maybeSingle<{ target_id: string }>();
    if (aliasError) throw new BookingDomainError("database_error", aliasError.message);
    if (alias) {
      const { data: canonical, error: canonicalError } = await supabase.from("customers").select(CUSTOMER_SELECT)
        .eq("id", alias.target_id).eq("location_id", salonId).maybeSingle<Customer>();
      if (canonicalError) throw new BookingDomainError("database_error", canonicalError.message);
      return canonical;
    }
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

export async function resolveBookingCustomer(input: {
  deferWrites?: boolean;
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
    const { data: identityRows, error: identityError } = await input.supabase.rpc("booking_customer_identity_matches", {
      p_salon: input.salonId, p_name: input.customer.name ?? user?.display_name ?? "", p_phone: normalizedPhone, p_email: normalizedEmail,
    });
    if (identityError) throw new BookingDomainError("database_error", identityError.message);
    const candidates = (identityRows ?? []) as Customer[];
    if (candidates.length >= 20) throw new BookingDomainError("conflict", "Multiple customer profiles matched. Select the correct customer.");
    const matchName = input.customer.name?.trim() || user?.display_name || "";
    const phoneMatches = candidates.filter(c => normalizedPhone && customerPhoneKey(c.phone) === normalizedPhone);
    const emailMatches = candidates.filter(c => normalizedEmail && normalizeBookingEmail(c.email) === normalizedEmail);
    const safePhoneMatches = phoneMatches.filter(c => customerNameKey(matchName).length >= 3 && customerNameSimilarity(matchName,c.name) >= 0.75);
    const phoneMatch = safePhoneMatches[0] ?? null;
    const emailMatch = emailMatches.length === 1 ? emailMatches[0] : null;
    if (new Set(safePhoneMatches.map(c => c.customer_user_id).filter(Boolean)).size > 1 || emailMatches.length > 1 || (phoneMatch && emailMatch && phoneMatch.id !== emailMatch.id)) {
      throw new BookingDomainError("conflict", "Multiple customer profiles matched. Select the correct customer.");
    }
    const matchedCustomer = phoneMatch ?? emailMatch;
    if (!matchedCustomer && candidates.length > 0) throw new BookingDomainError("conflict", "Possible existing customer. Check the name and phone or select the correct profile.");

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

      if (user?.id && !matchedCustomer.customer_user_id && !input.deferWrites) {
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
    if (input.deferWrites) {
      // A proposal only. The booking RPC resolves again under the identity lock
      // and commits customer creation/linking together with the appointment.
      return bookingOk({
        created: true,
        customer: { name, phone: normalizedPhone, email: normalizedEmail } as Customer,
        customerUserId: user?.id ?? input.customer.customerUserId ?? null,
        matchedBy: "created",
      });
    }
    const { data: creationResult, error: createError } = await input.supabase.rpc("create_booking_customer_identity", {
      p_salon: input.salonId, p_name: name, p_phone: normalizedPhone, p_email: normalizedEmail,
      p_user: user?.id ?? null, p_actor: input.actorUserId ?? null,
      p_source: user ? "account_link" : input.bookingSource === "public_profile" || input.bookingSource === "explore" ? "public_booking" : input.bookingSource === "pos" ? "pos" : "owner_booking",
    });
    const createdCustomer = (creationResult?.customer as Customer | undefined) ?? null;

    if (createError || !createdCustomer) {
      throw new BookingDomainError(
        "database_error",
        createError?.message ?? "Unable to create customer.",
      );
    }

    return bookingOk({
      created: creationResult?.created === true,
      customer: createdCustomer,
      customerUserId: user?.id ?? input.customer.customerUserId ?? null,
      matchedBy: user ? "customer_user" : "created",
    });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}
