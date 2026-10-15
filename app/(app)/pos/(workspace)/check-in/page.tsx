import { withExperiencePage } from "@/components/experience-page";
import {PortableCheckInClient} from '@/app/pos/portable/check-in/portable-check-in-client';
import {getOwnerCheckInData,ownerSubmitAttendance} from '@/app/pos/owner-check-in-actions';
async function OwnerCheckInPage(){return <PortableCheckInClient data={await getOwnerCheckInData()} action={ownerSubmitAttendance} workspacePath="/pos/check-in" staffEndpoint="/api/pos/owner/check-in"/>;}

export default withExperiencePage(OwnerCheckInPage);
