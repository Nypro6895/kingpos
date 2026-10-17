"use client";
import { COLLAPSED_COMMENTS, type ExploreCommentPresentation } from "@/lib/explore-comment-presentation";
import { ExploreCommentPreview } from "./explore-comment-preview";
import { explorePostIdentity } from "@/lib/explore-post-presentation";
import {useState} from "react";
import Link from "next/link";
import Image from "next/image";
import {ExploreSalonFollow,ExploreSalonMenu,ExploreSocialActions,useSalonSocial} from "@/components/explore-social";
import {PostCommentThread} from "@/app/post-comments/post-comment-thread";
import {useHiddenPosts,postIdentity} from "@/components/post-safety";
import {usePostCaption} from "@/components/post-change-state";
import {isSalonId} from "@/lib/explore-social";
import type {ExploreInspirationItem} from "@/types/explore";
import type {PostCommentTarget,PostCommentViewer} from "@/types/post-comments";

export function ExploreInspirationPost({item,viewer,onOpen,priority=false,showMedia=true,showCaption=true,inlineComments=true,onOpenComments,commentPresentation=COLLAPSED_COMMENTS}:{item:ExploreInspirationItem;viewer:PostCommentViewer;onOpen?:(item:ExploreInspirationItem)=>void;priority?:boolean;showMedia?:boolean;showCaption?:boolean;inlineComments?:boolean;onOpenComments?:()=>void;commentPresentation?:ExploreCommentPresentation}) {
 const social=useSalonSocial(item.salonId),hidden=useHiddenPosts(viewer.userId);
 const [expanded,setExpanded]=useState(false),[focusKey,setFocusKey]=useState(0),[count,setCount]=useState(item.commentCount??0);
 const target:PostCommentTarget={salonId:item.salonId,salonName:item.salonName,sourceId:item.contentId,sourceType:item.contentType==='update'?'salon_profile_update':'salon_profile_look',title:item.captionExcerpt??item.serviceName};
 const caption=usePostCaption(target,item.captionExcerpt,viewer.userId)??null;
 const openComments=()=>{if(onOpenComments){onOpenComments();return;}setExpanded(true);setFocusKey(key=>key+1);};
 const realPost=isSalonId(item.contentId),author=explorePostIdentity({source:"salon",salonName:item.salonName,authorName:item.authorIsAnonymous?null:item.authorDisplayName,authorRole:item.authorRole}).primary;
 const href=realPost?`${item.salonHref??`/explore/salons/${item.salonId}`}#${item.contentType}-${item.contentId}`:item.contentType==='look'?`/explore/looks/${item.contentId}`:item.salonHref??`/explore/salons/${item.salonId}`;
 const salon={id:item.salonId,name:item.salonName,href:item.salonHref,city:item.salonCity,state:item.salonState,bookingHref:item.bookingEnabled?item.bookingHref:null,phone:item.phoneHref?.replace(/^tel:/,'')};
 if(social.state.hidden||hidden.includes(postIdentity(target)))return null;
 const photo=<span className="relative block aspect-[4/3] overflow-hidden bg-surface-muted"><Image src={item.imageUrl} alt={`${item.serviceName??"Salon work"} from ${item.salonName}`} fill sizes="(max-width:640px) 100vw, (max-width:1280px) 50vw, 33vw" priority={priority} className="object-cover"/></span>;
 return <article className="min-w-0 border-b border-divider-subtle bg-white pb-2" data-testid="explore-inspiration-post">
  {showMedia ? onOpen?<button type="button" className="block w-full text-left" aria-label={`Open ${item.salonName} post`} onClick={()=>onOpen({...item,captionExcerpt:caption})}>{photo}</button>:<Link prefetch={false} href={href}>{photo}</Link> : null}
  <div data-feed-identity className="flex items-center gap-2 px-3 py-2"><span data-post-avatar aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-50 text-xs font-semibold text-brand-orange">{author.split(/\s+/).slice(0,2).map(part=>part[0]).join('')}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-1 text-sm"><span title={author} className="min-w-0 truncate font-semibold">{author}</span>{author!==item.salonName?<><span>Â·</span><Link prefetch={false} href={salon.href??href}>{item.salonName}</Link></>:null}<ExploreSalonFollow salon={salon}/></div><p className="text-xs text-text-muted">{[item.salonCity,item.salonState].filter(Boolean).join(' Â· ')}</p></div><ExploreSalonMenu salon={salon} target={realPost?target:undefined}/></div>
  {showCaption&&caption?<p className="px-3 pb-2 text-sm leading-5">{caption}</p>:null}
  <div className="px-3"><ExploreSocialActions salon={salon} href={href} target={item.saveTarget} commentCount={count} onComment={realPost?openComments:undefined}/>{!expanded&&commentPresentation.preview&&realPost?<ExploreCommentPreview key={`${viewer.userId}:${target.sourceType}:${target.sourceId}`} target={target} onOpen={openComments}/>:null}{inlineComments&&(commentPresentation.composer||expanded)&&realPost?<div onFocusCapture={()=>setExpanded(true)}><PostCommentThread compact inlineComposer expanded={expanded} focusKey={focusKey} initialCount={count} onCountChange={setCount} target={target} viewer={viewer}/></div>:null}</div>
 </article>;
}
