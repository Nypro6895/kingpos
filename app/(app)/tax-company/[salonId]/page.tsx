import { redirect } from "next/navigation";
export default async function LegacyTaxBusiness({params}:{params:Promise<{salonId:string}>}){const {salonId}=await params;redirect(`/tax/${encodeURIComponent(salonId)}`);}
