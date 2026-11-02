import type {RewardDiscoveryKind,RewardDiscoverySalon,RewardEarningEligibility} from "./reward-discovery";

/** Both copy and CTA use this single decision; unknown one-time status is not eligibility. */
function rewardMode(salon:RewardDiscoverySalon,kind:RewardDiscoveryKind,eligibility?:RewardEarningEligibility){
 const spend=salon.spendPoints>0&&(eligibility?.spend??true),visit=salon.visitPoints>0&&(eligibility?.visit??true);
 const referral=salon.conversionPoints>0&&(eligibility?.beforeAfter??true),welcome=salon.welcomePoints>0&&eligibility?.welcome===true,first=salon.firstBookingPoints>0&&eligibility?.firstBooking===true;
 if(kind==='before_after')return referral?'referral':'neutral';
 if(kind==='welcome')return welcome?'welcome':'welcome-info';
 if(kind==='spend')return spend?'spend':'neutral';
 return spend||visit?'visit':referral?'referral':first?'first':welcome?'welcome':'neutral';
}
export function rewardInvitation(salon:RewardDiscoverySalon,kind:RewardDiscoveryKind='all',eligibility?:RewardEarningEligibility){
 switch(rewardMode(salon,kind,eligibility)){
 case 'referral':return {title:'Share your look. Earn rewards.',body:'Earn when a guest books through your Before & After, completes the visit and pays in full.'};
 case 'welcome':return {title:'A welcome reward for your visit',body:'Join this salon’s program through an eligible visit to receive your one-time welcome points.'};
 case 'welcome-info':return {title:'Discover this salon’s welcome rewards',body:'Welcome points are a one-time benefit. Check the conditions and your eligibility before your visit.'};
 case 'spend':return {title:salon.canBook?'Book a visit. Earn rewards.':'Make your next visit rewarding.',body:'Earn points on qualifying services when your visit is completed and paid in full.'};
 case 'visit':return {title:salon.canBook?'Book a visit. Earn rewards.':'Make your next visit rewarding.',body:'Make time for yourself. Earn points on qualifying completed, fully paid visits.'};
 case 'first':return {title:'A reward for your first paid booking',body:'Your eligible first completed, fully paid booking can earn points at this salon.'};
 default:return {title:'Your rewards at this salon',body:'Explore the salon and review your rewards. One-time benefits depend on your eligibility.'};
 }
}

export function rewardLocalLabel(salon:RewardDiscoverySalon){
 const area=[salon.city,salon.state].filter(Boolean).join(", ");
 return [typeof salon.distanceMiles==="number"&&Number.isFinite(salon.distanceMiles)?`${salon.distanceMiles} mi`:null,area].filter(Boolean).join(" · ");
}
export function rewardVisitTarget(salon:RewardDiscoverySalon,kind:RewardDiscoveryKind="all",eligibility?:RewardEarningEligibility){
 const mode=rewardMode(salon,kind,eligibility);
 const visitEarning=mode==='spend'||mode==='visit'||mode==='first'||mode==='welcome';
 return salon.canBook&&visitEarning?`/book/${salon.id}?source=explore`:`/explore/salons/${salon.id}#salon-rewards`;
}
export function rewardNailIllustration(salon:RewardDiscoverySalon,category=""){
 const chosen=category.trim();
 if(chosen&&chosen.toLowerCase()!=="all")return /nail|manicur|pedicur/i.test(chosen);
 return (salon.serviceCategories??[]).length>0&&(salon.serviceCategories??[]).every(c=>/nail|manicur|pedicur/i.test(c));
}
