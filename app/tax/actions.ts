"use server";

import { revalidatePath } from "next/cache";
import { taxWorkspaceClient } from "@/lib/tax-workspace";
import { taxReceiptCents, validateTaxFile } from "@/lib/tax-workspace-model";
import { setNormalizedWorkspaceContext } from "@/lib/current-context";
import { taxWorkspaceOption } from "@/lib/tax-role";
import { taxQaRequest } from "@/lib/tax-workspace-qa";

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const failure = (error: unknown): Result<never> => ({
  ok: false,
  error:
    error instanceof Error
      ? error.message
      : "The change could not be saved. Try again.",
});
function refresh(salonId?: string) {
  revalidatePath("/tax", "layout");
  revalidatePath("/payroll/tax-company");
  revalidatePath("/account/tax-documents");
  if (salonId) revalidatePath(`/tax/${salonId}`);
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { client } = await taxWorkspaceClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function saveTaxProfile(form: FormData): Promise<Result> {
  try {
    const name = String(form.get("display_name") ?? "").trim(),
      email = String(form.get("contact_email") ?? "").trim();
    if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email))
      throw new Error("Enter your name and a valid contact email.");
    const qa = await taxQaRequest();
    if (qa) {
      qa.profile = {
        user_id: qa.userId,
        display_name: name,
        contact_email: email,
        phone: String(form.get("phone") ?? ""),
        company_name: String(form.get("company_name") ?? ""),
      };
      return { ok: true, data: qa.profile };
    }
    const data = await rpc("tax_save_profile", {
      p_name: name,
      p_email: email,
      p_phone: String(form.get("phone") ?? ""),
      p_company: String(form.get("company_name") ?? ""),
    });
    await setNormalizedWorkspaceContext(taxWorkspaceOption());
    refresh();
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function connectTaxBusiness(form: FormData): Promise<Result> {
  try {
    const qa = await taxQaRequest();
    if (qa)
      return {
        ok: false,
        error: "Local QA does not connect to real salon credentials.",
      };
    const { client, context } = await taxWorkspaceClient();
    const { data: profile } = await client
      .from("tax_profiles")
      .select("user_id")
      .eq("user_id", context.user!.id)
      .maybeSingle();
    if (!profile) throw new Error("Activate your Tax profile first.");
    const { data, error } = await client.rpc("tax_company_connect", {
      p_login: String(form.get("login_id") ?? ""),
      p_password: String(form.get("password") ?? ""),
    });
    if (error || data?.error) throw new Error(data?.error ?? error?.message);
    refresh();
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function updateTaxWork(input: {
  salonId: string;
  runId: string;
  staffId: string;
  status: string;
  expected: number;
}): Promise<Result> {
  try {
    const qa = await taxQaRequest();
    if (qa) {
      const l = qa.data.lines.find(
        (l) => l.run_id === input.runId && l.staff_id === input.staffId,
      );
      if (!l || l.work_version !== input.expected)
        throw new Error("Status changed. Refresh before saving.");
      l.work_status = input.status as typeof l.work_status;
      l.work_version++;
      return {
        ok: true,
        data: { version: l.work_version, status: l.work_status },
      };
    }
    const data = await rpc("tax_set_work", {
      p_salon: input.salonId,
      p_run: input.runId,
      p_staff: input.staffId,
      p_status: input.status,
      p_expected: input.expected,
    });
    refresh(input.salonId);
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function sendTaxMessage(form: FormData): Promise<Result> {
  try {
    const salonId = String(form.get("salon_id")),
      body = String(form.get("body") ?? "").trim();
    if (!body || body.length > 4000)
      throw new Error("Enter a message of up to 4,000 characters.");
    const qa = await taxQaRequest();
    if (qa) {
      const m = {
        id: crypto.randomUUID(),
        staff_id: String(form.get("staff_id") || "") || null,
        payroll_run_id: String(form.get("run_id") || "") || null,
        author_id: qa.userId,
        author_name: qa.profile!.display_name,
        body,
        document_id: null,
        created_at: new Date().toISOString(),
      };
      qa.data.messages.push(m);
      return { ok: true, data: m };
    }
    const data = await rpc("tax_send_message", {
      p_salon: salonId,
      p_body: body,
      p_staff: String(form.get("staff_id") || "") || null,
      p_run: String(form.get("run_id") || "") || null,
      p_document: String(form.get("document_id") || "") || null,
    });
    refresh(salonId);
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function uploadTaxDocument(form: FormData): Promise<Result> {
  try {
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file.");
    validateTaxFile(file);
    const salonId = String(form.get("salon_id")),
      kind = String(form.get("kind")),
      staffId = String(form.get("staff_id") || "") || null,
      runId = String(form.get("run_id") || "") || null,
      supersedes = String(form.get("supersedes_id") || "") || null;
    const qa = await taxQaRequest();
    if (qa) {
      const old = qa.data.documents.find((d) => d.id === supersedes);
      if (old) old.archived_at = new Date().toISOString();
      const doc = {
        id: crypto.randomUUID(),
        salon_id: salonId,
        staff_id: staffId,
        recipient_user_id: staffId ? qa.staffUserId : null,
        payroll_run_id: runId,
        kind: kind as "paystub",
        title: file.name,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        version: (old?.version ?? 0) + 1,
        supersedes_id: supersedes,
        uploaded_by: qa.userId,
        uploaded_role: qa.mode,
        created_at: new Date().toISOString(),
        archived_at: null,
        owner_deleted_at: null,
      };
      qa.data.documents.unshift(doc);
      return { ok: true, data: doc };
    }
    const { client } = await taxWorkspaceClient();
    const { data: reservation, error: startError } = await client.rpc(
      "tax_begin_upload",
      {
        p_salon: salonId,
        p_kind: kind,
        p_staff: staffId,
        p_run: runId,
        p_name: file.name,
        p_mime: file.type,
        p_size: file.size,
        p_supersedes: supersedes,
        p_share_staff: form.get("share_staff") === "true",
      },
    );
    if (startError) throw new Error(startError.message);
    const { error: uploadError } = await client.storage
      .from("payroll-paystubs")
      .upload(reservation.path, file, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);
    const { data, error } = await client.rpc("tax_finish_upload", {
      p_upload: reservation.id,
    });
    if (error) throw new Error(error.message);
    refresh(salonId);
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function archiveTaxDocument(input: {
  id: string;
  restore?: boolean;
}): Promise<Result> {
  try {
    const qa = await taxQaRequest();
    if (qa) {
      const d = qa.data.documents.find((x) => x.id === input.id);
      if (!d) throw new Error("Document unavailable.");
      if (qa.mode !== "owner" && (input.restore || d.uploaded_role === "owner"))
        throw new Error("Owner access required.");
      d.archived_at = input.restore ? null : new Date().toISOString();
      return { ok: true, data: null };
    }
    await rpc("tax_archive_document", {
      p_document: input.id,
      p_restore: Boolean(input.restore),
    });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}
export async function removeOwnerTaxDocument(id: string): Promise<Result> {
  try {
    const qa = await taxQaRequest();
    if (qa) {
      if (qa.mode !== "owner") throw new Error("Owner access required.");
      const d = qa.data.documents.find((x) => x.id === id);
      if (d) d.owner_deleted_at = new Date().toISOString();
      return { ok: true, data: null };
    }
    await rpc("tax_owner_delete_document", { p_document: id });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}
export async function addTaxReceipt(form: FormData): Promise<Result> {
  try {
    const salonId = String(form.get("salon_id")),
      cents = taxReceiptCents(String(form.get("amount") ?? ""));
    const values = {
      category: String(form.get("category")),
      description: String(form.get("description") ?? "").trim(),
      amount_cents: cents,
      receipt_date: String(form.get("receipt_date")),
      status: String(form.get("status")),
      document_id: String(form.get("document_id") || "") || null,
    };
    if (!values.description) throw new Error("Enter a receipt description.");
    const qa = await taxQaRequest();
    if (qa) {
      const item = {
        ...values,
        id: crypto.randomUUID(),
        currency: "USD",
        archived_at: null,
        created_at: new Date().toISOString(),
      };
      qa.data.receipts.unshift(item as (typeof qa.data.receipts)[number]);
      return { ok: true, data: item };
    }
    const data = await rpc("tax_save_receipt", {
      p_salon: salonId,
      p_category: values.category,
      p_description: values.description,
      p_cents: cents,
      p_date: values.receipt_date,
      p_status: values.status,
      p_document: values.document_id,
      p_request: String(form.get("request_id") || "") || null,
    });
    refresh(salonId);
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}
export async function archiveTaxReceipt(id: string): Promise<Result> {
  try {
    const qa = await taxQaRequest();
    if (qa) {
      const x = qa.data.receipts.find((x) => x.id === id);
      if (x) x.archived_at = new Date().toISOString();
      return { ok: true, data: null };
    }
    await rpc("tax_archive_receipt", { p_id: id });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}
