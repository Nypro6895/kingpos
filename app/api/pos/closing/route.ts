import { dailyClosingRequest, validateClosingRequest, type ClosingRequest } from "@/lib/daily-closing-server";

export const maxDuration = 30;
const response = (body: unknown, status = 200) => Response.json(body, {status, headers: {"Cache-Control": "private, no-store"}});

async function execute(input: ClosingRequest, write: boolean) {
  try { validateClosingRequest(input, write); }
  catch (error) { return response({ok: false, error: error instanceof Error ? error.message : "Invalid request.", outcomeUnknown: false}, 400); }
  try {
    const {data, error} = await dailyClosingRequest(input, write);
    if (error) {
      const definitive = ["42501", "PT409", "55000", "22023", "P0001", "22P02", "22003"].includes(error.code ?? "");
      return response({ok: false, error: definitive ? error.message : "Unable to confirm the saved result. Check the saved result before retrying.", outcomeUnknown: write && !definitive}, error.code === "42501" ? 403 : error.code === "PT409" ? 409 : definitive ? 400 : 503);
    }
    return response({ok: true, ...data});
  } catch {
    return response({ok: false, error: "Unable to confirm the saved result. Check the saved result before retrying.", outcomeUnknown: write}, 503);
  }
}

export async function GET(request: Request) {
  if (request.headers.get("x-reylumi-auth-unavailable") === "1") return response({ok: false}, 503);
  const params = new URL(request.url).searchParams;
  return execute({mode: params.get("mode") as ClosingRequest["mode"], salonId: params.get("salonId") ?? "", expectedScope:params.get("expectedScope") ?? "", date: params.get("date") ?? "", ...(params.get("requestId") ? {requestId: params.get("requestId")!} : {})}, false);
}

export async function POST(request: Request) {
  if (request.headers.get("x-reylumi-auth-unavailable") === "1") return response({ok: false, outcomeUnknown: false}, 503);
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return response({ok: false, error: "Invalid request origin.", outcomeUnknown: false}, 403);
  let input: ClosingRequest;
  try { input = await request.json(); } catch { return response({ok: false, error: "Invalid request.", outcomeUnknown: false}, 400); }
  return execute(input, true);
}
