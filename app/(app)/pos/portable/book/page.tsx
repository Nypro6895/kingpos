import {
  getPortableBookData,
  portableCreateAppointment,
  portableBookingSlots,
  portableBookingHours,
  portableBookingAppointments,
  portableBookingStaffOptions,
  portableManageBooking,
  portableSearchBookingCustomers,
} from "@/app/pos/portable/actions";
import { PortableBookWorkspace } from "@/app/pos/portable/book/portable-book-workspace";

type PortableBookPageProps = {
  searchParams: Promise<{ date?: string }>;
};

function validDate(value: string | undefined) {
  return value?.match(/^\d{4}-\d{2}-\d{2}$/) ? value : undefined;
}

export default async function PortableBookPage({
  searchParams,
}: PortableBookPageProps) {
  const params = await searchParams;
  const data = await getPortableBookData(validDate(params.date));

  return (
    <div className="h-full" data-portable-pos-page="book">
      <PortableBookWorkspace refreshAction={portableBookingAppointments} hoursAction={portableBookingHours} staffOptionsAction={portableBookingStaffOptions} action={portableCreateAppointment} slotsAction={portableBookingSlots} manageAction={portableManageBooking} data={data} searchCustomersAction={portableSearchBookingCustomers} />
    </div>
  );
}
