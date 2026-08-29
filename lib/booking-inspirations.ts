import "server-only";

import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type {
  BookingInspiration,
  BookingInspirationView,
} from "@/types/booking";

export const BOOKING_INSPIRATION_SELECT =
  "id, salon_id, booking_id, booking_line_id, source_type, source_content_id, source_salon_id, source_media_asset_id, source_media_bucket, source_media_path, source_media_width, source_media_height, source_media_mime_type, credited_staff_id, service_id, source_title_snapshot, source_caption_snapshot, source_booking_note_snapshot, service_name_snapshot, credited_staff_name_snapshot, salon_name_snapshot, metadata, created_at, updated_at";

export function mapBookingInspiration(
  row: BookingInspiration | null | undefined,
): BookingInspirationView | null {
  if (!row) {
    return null;
  }

  return {
    ...row,
    imageUrl: getSalonProfileMediaUrl(row.source_media_path),
  };
}

export function mapBookingInspirationsByBookingId(
  rows: BookingInspiration[] | null | undefined,
) {
  const inspirationsByBookingId = new Map<string, BookingInspirationView>();

  for (const row of rows ?? []) {
    const inspiration = mapBookingInspiration(row);

    if (inspiration) {
      inspirationsByBookingId.set(inspiration.booking_id, inspiration);
    }
  }

  return inspirationsByBookingId;
}
