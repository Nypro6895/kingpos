export function countBookedAppointments(items: ReadonlyArray<{ normalizedStatus: string }>) {
  return items.filter(item => !["cancelled", "no_show"].includes(item.normalizedStatus)).length;
}
