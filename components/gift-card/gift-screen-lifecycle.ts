import type {GiftSession} from "@/types/gift-card";

export const GIFT_COMPLETION_SECONDS=60;

function screenKey(session:GiftSession){return `${session.status}:${session.prompt??0}`;}
export function rememberGiftScreen(session:GiftSession){
  try{sessionStorage.setItem("kingpos-gift-dismiss:"+session.id,screenKey(session));}catch{/* Server synchronization remains authoritative. */}
}

export function giftScreenClosed(session:GiftSession,now=Date.now()) {
  const expired=Date.parse(session.expires)<=now;
  const completed=Date.parse(session.completedAt??"");
  let locallyClosed=false;
  try{locallyClosed=sessionStorage.getItem("kingpos-gift-dismiss:"+session.id)===screenKey(session);}catch{/* Storage can be unavailable in kiosk mode. */}
  return locallyClosed || session.dismissed===true || expired || !["open","completed"].includes(session.status)
    || session.status==="completed" && (session.collected===true || Number.isFinite(completed) && completed+GIFT_COMPLETION_SECONDS*1000<=now);
}

export function giftScreenPrompted(next:GiftSession,previous?:GiftSession) {
  if(giftScreenClosed(next))return false;
  if(next.status==="completed")return previous?.status!=="completed" || previous.id!==next.id;
  return (next.prompt??0)>(previous?.id===next.id?(previous.prompt??0):0);
}

export function giftDismissArgs(session:GiftSession) {
  return {sessionId:session.id,prompt:session.prompt??0,status:session.status};
}
