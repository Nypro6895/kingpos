import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { adminCsvCell } from "@/lib/platform-admin/csv";

export async function GET(request: NextRequest) {
  const context = await getCurrentPlatformAdminContext();
  if (!context?.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.usersRead)) return NextResponse.json({ error:"Access denied" },{ status:403 });
  const params = request.nextUrl.searchParams;
  const search = { q:params.get("q"),status:params.get("status"),role:params.get("role"),businessId:params.get("businessId"),sort:params.get("sort"),pageSize:"100" };
  try {
    const first = await searchPlatformAdminUsers(search);
    if (first.total>5000) return NextResponse.json({ error:"Refine the filters to export 5,000 users or fewer." },{ status:400 });
    const users = [...first.items];
    for (let page=2;page<=Math.ceil(first.total/100);page++) users.push(...(await searchPlatformAdminUsers({...search,page:String(page)})).items);
    const rows = [["User ID","Name","Email","Phone","Status","Business roles","Businesses","Created","Last login"],...users.map(user => [user.id,user.display_name,user.email,user.phone,user.status,user.roles?.join("; "),user.businesses?.map(item => item.name).join("; "),user.created_at,user.last_login_at])];
    return new NextResponse("\uFEFF"+rows.map(row => row.map(adminCsvCell).join(",")).join("\r\n"),{ headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=reylumi-users.csv","Cache-Control":"private, no-store"} });
  } catch { return NextResponse.json({ error:"The export could not be generated. Check the filters and retry." },{ status:503 }); }
}
