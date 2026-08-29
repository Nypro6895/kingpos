import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcError = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: RpcError | null;
}>;

type PublicSalonProfileRow = {
  logo_path?: string | null;
};

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

export async function loadPublicSalonLogoPaths(input: {
  rpc: RpcRunner;
  salonIds: string[];
}) {
  const uniqueSalonIds = [...new Set(input.salonIds)].filter((salonId) =>
    UUID_PATTERN.test(salonId),
  );
  const entries = await Promise.all(
    uniqueSalonIds.map(async (salonId) => {
      const { data, error } = await input.rpc("get_public_salon_profile", {
        target_salon_id: salonId,
      });

      if (error) {
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const logoPath = cleanString((row as PublicSalonProfileRow | null)?.logo_path);

      return logoPath ? ([salonId, logoPath] as const) : null;
    }),
  );

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, string] => entry !== null,
    ),
  );
}
