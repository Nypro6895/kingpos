export function forumRelativeTime(value: string, now = Date.now()) {
  const at=Date.parse(value); if(!Number.isFinite(at)) return "";
  const minutes=Math.max(0,Math.floor((now-at)/60000));
  if(minutes<1)return "Vừa xong";
  if(minutes<60)return `${minutes} phút`;
  if(minutes<1440)return `${Math.floor(minutes/60)} giờ`;
  if(minutes<10080)return `${Math.floor(minutes/1440)} ngày`;
  return new Intl.DateTimeFormat("vi-VN",{day:"numeric",month:"numeric"}).format(new Date(at));
}
