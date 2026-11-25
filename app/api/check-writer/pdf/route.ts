import { isSameOriginMutation } from "@/lib/request-origin";
import { CHECK_WRITER_UNAVAILABLE_MESSAGE } from "@/lib/check-writer-availability";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

// No PDF, bank, body, or output-authority work while check printing is unavailable.
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return Response.json(
      { error: "Invalid request origin." },
      { status: 403, headers },
    );
  }
  return Response.json(
    { error: CHECK_WRITER_UNAVAILABLE_MESSAGE },
    { status: 503, headers },
  );
}
