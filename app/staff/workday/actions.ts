"use server";

import {
  getTodayDate,
  getCurrentStaffForSalon,
  STAFF_WORKDAY_SELECT,
} from "@/lib/staff-workdays";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffWorkdayWithStaff } from "@/types/staff-workday";
import type { StaffWorkdayStatus } from "@/types/staff-workday";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function redirectWithError(message: string): never {
  redirect(`/staff/workday?error=${encodeURIComponent(message)}`);
}

async function requireWorkdayMutationContext() {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization) {
    redirectWithError("Create an organization before using My Work Today.");
  }

  if (!context.currentSalon) {
    redirectWithError("Please select a salon first.");
  }

  const staff = await getCurrentStaffForSalon(context);

  return {
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    staff,
    supabase,
    today: getTodayDate(context.user.timezone),
  };
}

async function loadMutableWorkday() {
  const { organization, salon, staff, supabase, today } =
    await requireWorkdayMutationContext();
  const { data: workday, error: workdayError } = await supabase
    .from("staff_workdays")
    .select(STAFF_WORKDAY_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("staff_id", staff.id)
    .eq("work_date", today)
    .maybeSingle<StaffWorkdayWithStaff>();

  if (workdayError) {
    console.error("Supabase staff workday mutation lookup failed", {
      code: workdayError.code,
      message: workdayError.message,
      details: workdayError.details,
      hint: workdayError.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
    });
    redirectWithError(workdayError.message);
  }

  if (!workday || !workday.check_in_at) {
    redirectWithError("You must check in before changing work status.");
  }

  if (workday.check_out_at || workday.status === "checked_out") {
    redirectWithError("Checked out workdays cannot be changed.");
  }

  return { organization, salon, staff, supabase, workday };
}

export async function checkInStaffWorkday() {
  const { organization, salon, staff, supabase, today } =
    await requireWorkdayMutationContext();

  const { data: workday, error: workdayError } = await supabase
    .from("staff_workdays")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("staff_id", staff.id)
    .eq("work_date", today)
    .maybeSingle<{ id: string }>();

  if (workdayError) {
    console.error("Supabase check in staff workday lookup failed", {
      code: workdayError.code,
      message: workdayError.message,
      details: workdayError.details,
      hint: workdayError.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
    });
    redirectWithError(workdayError.message);
  }

  if (workday) {
    redirectWithError("You are already checked in for today.");
  }

  const { error } = await supabase
    .from("staff_workdays")
    .insert({
      check_in_at: new Date().toISOString(),
      organization_id: organization.id,
      salon_id: salon.id,
      staff_id: staff.id,
      status: "checked_in",
      work_date: today,
    })
    .select(STAFF_WORKDAY_SELECT)
    .single<StaffWorkdayWithStaff>();

  if (error) {
    console.error("Supabase check in staff workday failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
    });
    redirectWithError(error.message);
  }

  revalidatePath("/staff/workday");
  redirect("/staff/workday");
}

export async function checkOutStaffWorkday() {
  const { organization, salon, staff, supabase, workday } =
    await loadMutableWorkday();
  if (workday.salon_id !== salon.id || workday.staff_id !== staff.id) {
    redirectWithError("Today's workday does not belong to the current salon.");
  }

  const { error } = await supabase
    .from("staff_workdays")
    .update({
      check_out_at: new Date().toISOString(),
      status: "checked_out",
    })
    .eq("id", workday.id)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("staff_id", staff.id);

  if (error) {
    console.error("Supabase check out staff workday failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      workdayId: workday.id,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
    });
    redirectWithError(error.message);
  }

  revalidatePath("/staff/workday");
  revalidatePath("/staff/today");
  redirect("/staff/workday");
}

export async function updateStaffWorkdayStatus(formData: FormData) {
  const status = formData.get("status");
  const validStatuses: StaffWorkdayStatus[] = ["working", "break", "unavailable"];

  if (typeof status !== "string" || !validStatuses.includes(status as StaffWorkdayStatus)) {
    redirectWithError("Choose a valid work status.");
  }

  const { organization, salon, staff, supabase, workday } =
    await loadMutableWorkday();

  const { error } = await supabase
    .from("staff_workdays")
    .update({ status })
    .eq("id", workday.id)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("staff_id", staff.id);

  if (error) {
    console.error("Supabase update staff workday status failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      workdayId: workday.id,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
    });
    redirectWithError(error.message);
  }

  revalidatePath("/staff/workday");
  revalidatePath("/staff/today");
  redirect("/staff/workday");
}
