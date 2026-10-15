"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { taxCompanyClient } from "@/lib/tax-company";
import { marketPluginContext } from "@/lib/market-plugins";
import { uploadPayrollPaystub } from "@/lib/payroll";
import type { TaxCompanyNote } from "@/types/tax-company";

export async function saveTaxCompanyNote(salonId: string, content: string, version: number): Promise<{ note?: TaxCompanyNote; error?: string }> {
  try {
    if (typeof content !== "string" || content.length > 4000 || !Number.isSafeInteger(version) || version < 0) throw new Error("Enter a note of up to 4,000 characters.");
    const { client } = await taxCompanyClient();
    const { data, error } = await client.rpc("tax_company_save_note", { p_salon: salonId, p_content: content, p_version: version });
    if (error) throw new Error(error.message);
    revalidatePath(`/tax-company/${salonId}`);
    return { note: data as TaxCompanyNote };
  } catch (error) { return { error: error instanceof Error ? error.message : "Your note could not be saved." }; }
}

export async function updateTaxSettings(form: FormData) {
  let message = "Saved. Previous salon connections have been signed out.";
  try {
    const { client, salonId } = await marketPluginContext();
    const disconnect = form.get("disconnect") === "true";
    const { error } = await client.rpc("tax_company_settings", { p_salon: salonId, p_password: disconnect ? null : String(form.get("password") ?? ""), p_disconnect: disconnect });
    if (error) throw new Error(error.message);
    revalidatePath("/payroll"); revalidatePath("/tax-company");
  } catch (error) { message = error instanceof Error ? error.message : "Settings could not save."; }
  redirect(`/payroll/tax-company/settings?message=${encodeURIComponent(message)}`);
}
export async function connectTaxSalon(form: FormData) {
  let message = "";
  try {
    const { client } = await taxCompanyClient();
    const { data, error } = await client.rpc("tax_company_connect", { p_login: String(form.get("login_id") ?? ""), p_password: String(form.get("password") ?? "") });
    if (error || data?.error) throw new Error(data?.error ?? error?.message);
    revalidatePath("/tax-company");
  } catch (error) { message = error instanceof Error ? error.message : "Salon could not connect."; }
  redirect(`/tax-company${message ? `?message=${encodeURIComponent(message)}` : ""}`);
}
export async function disconnectTaxSalon(form: FormData) {
  const { client, context } = await taxCompanyClient();
  const { error } = await client.from("tax_company_connections").delete().eq("salon_id", String(form.get("salon_id"))).eq("user_id", context.user!.id);
  if (error) redirect("/tax-company?message=Salon%20could%20not%20disconnect.");
  revalidatePath("/tax-company"); redirect("/tax-company");
}
export async function uploadTaxPaystub(form: FormData) {
  const salonId = String(form.get("tax_salon_id") ?? "");
  let message = "";
  try {
    const file = form.get("paystub_file");
    if (!(file instanceof File) || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Upload a PDF, PNG, JPEG or WebP paystub.");
    await uploadPayrollPaystub({ file, payrollRunId: String(form.get("payroll_run_id")), staffId: String(form.get("staff_id")), taxSalonId: salonId });
    revalidatePath("/tax-company"); revalidatePath("/payroll"); revalidatePath("/staff");
  } catch (error) { message = error instanceof Error ? error.message : "Paystub could not upload."; }
  const runId = String(form.get("payroll_run_id") ?? "");
  redirect(`/tax-company/${encodeURIComponent(salonId)}?run=${encodeURIComponent(runId)}${message ? `&message=${encodeURIComponent(message)}` : ""}`);
}
