import Link from "next/link";
import { redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { isOwnerMembership } from "@/lib/current-context";
import { readOwnerFinancialAttention } from "@/lib/owner-financial-attention";
import { AttentionDetail, AttentionList } from "@/app/staff/today/attention-detail";
import { WorkspaceText as T } from "@/components/workspace-language";
import s from "@/app/staff/today/owner-attention.module.css";

async function OwnerAttentionPage({ searchParams }: { searchParams: Promise<{ item?: string; page?: string }> }) {
  const context = await requireSalonManagePageContext("/staff/today/attention");
  if (!isOwnerMembership(context.currentMembership)) redirect("/staff/today");
  const params = await searchParams;
  const page = /^\d{1,6}$/.test(params.page ?? "") ? Number(params.page) : 0;
  const item = typeof params.item === "string" && params.item.length <= 180 ? params.item : undefined;
  let data;
  try { data = await readOwnerFinancialAttention(context, item, page); }
  catch { return <main className={s.page}><Link href="/staff/today">← Today</Link><h1><T text="Financial checks unavailable" /></h1><p><T text="Please retry. No checks have been marked clear." /></p><Link href={`/staff/today/attention${item ? `?item=${encodeURIComponent(item)}` : ""}`}><T text="Try again" /></Link></main>; }
  return <main className={s.page}><Link href="/staff/today">← Today</Link>
    {item ? data.items[0] ? <AttentionDetail data={data} item={data.items[0]} /> : <p className={s.notice}><T text="This item was resolved or its figures changed. Open the current attention list." /><Link href="/staff/today/attention"> Attention →</Link></p> : <>
      <AttentionList data={data} page={page} />
    </>}
  </main>;
}
export default withExperiencePage(OwnerAttentionPage);
