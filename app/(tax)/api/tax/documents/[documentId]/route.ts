import { taxWorkspaceClient } from "@/lib/tax-workspace";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params,
      qa = await taxQaRequest();
    if (qa) {
      const doc = qa.data.documents.find(
        (d) =>
          d.id === documentId &&
          (qa.mode !== "staff" || d.recipient_user_id === qa.userId),
      );
      if (!doc) return new Response("Not found", { status: 404 });
      return new Response(
        `<html><body style="font:18px system-ui;padding:50px"><h1>Local QA document</h1><p>${doc.file_name.replace(/[<>&"]/g, "")}</p><p>Version ${doc.version} · Seeded test data</p></body></html>`,
        {
          headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
        },
      );
    }
    const { client } = await taxWorkspaceClient();
    const { data: allowed, error: accessError } = await client.rpc(
      "tax_document_access",
      { p_id: documentId },
    );
    if (accessError || !allowed)
      return new Response("Document unavailable", { status: 404 });
    const { data: doc, error } = await client
      .from("tax_documents")
      .select("bucket,path,file_name,mime_type")
      .eq("id", documentId)
      .single();
    if (error || !doc)
      return new Response("Document unavailable", { status: 404 });
    const { data: signed, error: signError } = await client.storage
      .from(doc.bucket)
      .createSignedUrl(doc.path, 60);
    if (signError || !signed) throw new Error("Document could not be opened.");
    const response = await fetch(signed.signedUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Document could not be opened.");
    const disposition =
      new URL(request.url).searchParams.get("download") === "1"
        ? "attachment"
        : "inline";
    return new Response(response.body, {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new Response(
      "Document unavailable. Sign in and check your access.",
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
