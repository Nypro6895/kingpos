import { checkWriterContext } from "@/lib/check-writer-server";
import { checkPdf } from "@/lib/check-writer-pdf";
import type { CheckRecord } from "@/types/check-writer";
import { readCheckBody } from "@/lib/check-writer-request";
import { randomUUID } from "node:crypto";
import { checkText } from "@/lib/check-writer-rules";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin)
      throw Error("Invalid request origin.");
    const body = await readCheckBody(req, 12000);
    const ctx = await checkWriterContext(true, true);
    if (body.salonId !== ctx.salonId)
      throw Error(
        "Workspace changed. Reopen Check Writer for the selected salon.",
      );
    if (
      !Array.isArray(body.ids) ||
      body.ids.length < 1 ||
      body.ids.length > 100 ||
      body.ids.some(
        (id: unknown) =>
          typeof id !== "string" ||
          !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
            id,
          ),
      ) ||
      new Set(body.ids).size !== body.ids.length
    )
      throw Error("Select checks to print.");
    const { data, error } = await ctx.service
      .from("check_writer_checks")
      .select("*")
      .eq("salon_id", ctx.salonId)
      .in("id", body.ids)
      .order("number");
    if (error || data?.length !== body.ids.length)
      throw Error("Checks could not load.");
    const preview = body.preview === true;
    const bytes = await checkPdf(data as CheckRecord[], ctx.salonId, preview, {
      x: Number(body.x ?? 0),
      y: Number(body.y ?? 0),
    });
    let outputId: string | undefined;
    if (!preview) {
      const reason = checkText(
        typeof body.reason === "string" ? body.reason : "",
        500,
      );
      if (reason.length > 500) throw Error("Print reason is too long.");
      outputId = randomUUID();
      const r = await ctx.service.rpc("check_writer_prepare_output", {
        p_salon: ctx.salonId,
        p_actor: ctx.user.id,
        p_output: outputId,
        p_ids: data.map((record) => record.id),
        p_expected: Object.fromEntries(
          data.map((record) => [record.id, record.delivery_count]),
        ),
        p_reason: reason,
      });
      if (r.error)
        throw Error(
          "Check cannot be printed. A reprint needs a reason; void checks are blocked.",
        );
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="check-writer.pdf"',
        ...(outputId ? { "X-Check-Writer-Output-ID": outputId } : {}),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "PDF could not be prepared.",
      },
      { status: 400, headers },
    );
  }
}
