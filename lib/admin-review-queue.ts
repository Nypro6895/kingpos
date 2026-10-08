export function filterAdminReviewQueue<T extends { status: string; created_at: string }>(items: T[], options: { q?: string; status?: string; sort?: string; page: number; pageSize: number }, searchable: (item:T)=>string) {
  const query = options.q?.trim().toLocaleLowerCase() ?? "";
  const filtered = items.filter(item => (!options.status || item.status === options.status) && (!query || searchable(item).toLocaleLowerCase().includes(query)));
  filtered.sort((a,b) => options.sort === "newest" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
  return { items:filtered.slice((options.page-1)*options.pageSize,options.page*options.pageSize), total:filtered.length,page:options.page,page_size:options.pageSize };
}
