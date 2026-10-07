"use client";
import Link from 'next/link';
import {ReylumiIcon} from '@/components/reylumi-icons';
import {LumiTrustPopover,LumiTrustMark} from '@/components/reylumi-trust';
import {buildReylumiTrustSummary,type ReylumiTrustSignalInput} from '@/lib/reylumi-trust';
export function SalonVerifiedBadge({verified}:{verified?:boolean}) {
 return verified?<span title="Salon identity approved" aria-label="Verified salon identity" className="inline-flex shrink-0 align-middle"><ReylumiIcon name="verified" className="size-3.5 text-sky-500"/></span>:null;
}
export function SalonTrustLine({signals,href,name,distance,compact=false,expanded=false,staticOnly=false,className=''}:{signals:ReylumiTrustSignalInput;href?:string|null;name:string;distance?:string|null;compact?:boolean;expanded?:boolean;staticOnly?:boolean;className?:string}) {
 const summary=buildReylumiTrustSummary({...signals,trustEvidence:signals.trustEvidence??null}),evidence=signals.trustEvidence;
 const visits=evidence?.verifiedVisitCount;
 const feedback=evidence?.feedbackCustomerCount;
 const target=href?`${href.split('#')[0]}#lumi-trust`:null;
 const detail=href?`${href.split('#')[0]}#customer-experiences`:null;
 const link=(text:string,url:string|null)=>url&&!staticOnly?url.startsWith('#')?<a href={url} className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange">{text}</a>:<Link href={url} className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange">{text}</Link>:<span>{text}</span>;
 return <span data-salon-trust-line className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-5 ${className}`}>
  <span className="inline-flex items-center gap-0.5">{staticOnly?<LumiTrustMark summary={summary} presentation="spark" size="xs" className="grid size-5 place-items-center bg-transparent p-0 shadow-none ring-0"/>:<LumiTrustPopover summary={summary} entityName={name} actionHref={target} presentation="spark" size="xs" markClassName="grid size-5 shrink-0 place-items-center bg-transparent p-0 shadow-none ring-0"/>}{summary.level==='empty'?<span>{evidence?'Building LUMI Truth':'Trust unavailable'}</span>:compact?null:<span className="font-semibold">{summary.mark.label}</span>}</span>
  <span aria-hidden>·</span>{link(visits==null?'Visits unavailable':`${visits.toLocaleString('en-US')} visited`,target)}
  {!compact&&feedback!=null?<><span aria-hidden>·</span>{link(`${feedback.toLocaleString('en-US')} opinions`,detail)}</>:null}
  {distance?<><span aria-hidden>·</span><span>{distance}</span></>:null}
  {expanded&&evidence&&feedback?<><span aria-hidden>·</span>{link(`${evidence.goodFeedbackCount} good`,href?`${href.split('#')[0]}#feedback-good`:null)}<span aria-hidden>·</span>{link(`${evidence.issueFeedbackCount} concerns`,href?`${href.split('#')[0]}#feedback-issue`:null)}</>:null}
 </span>;
}
