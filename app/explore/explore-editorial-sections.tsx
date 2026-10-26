"use client";
import { editorialCommentOptions, feedCommentCandidate, lookCommentCandidate, type ExploreCommentPresentation } from "@/lib/explore-comment-presentation";
import { useExploreCommentPresentation } from "./use-explore-comment-presentation";

import { ContentViewer } from "@/components/content-viewer";
import { SalonFeedPostPreview } from "@/components/salon-post-preview";
import { ExploreFeedCard } from "./explore-feed";
import { ExploreInspirationPost } from "./explore-inspiration-post";
import type { PostCommentViewer } from "@/types/post-comments";
import { useState, type ReactNode } from "react";
import { ExploreViewportImage as Image } from "./explore-viewport-image";
import Link from "next/link";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { ExploreBookButton } from "@/components/explore-account-actions";
import { useExploreSocial, useSalonSocial } from "@/components/explore-social";
import { ExploreSalonCard } from "./explore-salon-card";
import { LumiAiWatermark, NailIllustrationCredit } from "@/components/nail-illustration-credit";
import { isDefaultNailImage, resolveNailCoverImage } from "@/lib/default-nail-images";
import { exploreEditorialHref, exploreEditorialReferences, exploreServiceGuides, type ExploreEditorialReference } from "@/lib/explore-editorial";
import { exploreCaptionExcerpt } from "@/lib/explore-visual-presentation";
import type { ExploreFeedItem, ExploreInspirationItem, ExploreSearchResult } from "@/types/explore";
import styles from "./explore-editorial-sections.module.css";

type Entry = { key:string; image:string; title:string; description:string; href:string; look?:ExploreInspirationItem; feed?:ExploreFeedItem; reference?:ExploreEditorialReference };
function lookEntry(look:ExploreInspirationItem):Entry {
  return {key:look.mediaId,image:look.imageUrl,title:look.captionExcerpt || look.serviceName || "A look worth saving",description:look.salonName,href:look.contentType === "look" ? `/explore/looks/${look.contentId}` : look.salonHref || `/explore/salons/${look.salonId}`,look};
}
function feedEntry(feed:ExploreFeedItem):Entry {
  return {key:feed.feedKey,image:feed.media[0].imageUrl,title:feed.caption || feed.serviceName || feed.salon?.name || feed.author.name,description:feed.salon?.name || feed.author.name,href:feed.destination.href || "/explore",feed};
}
function referenceEntry(reference:ExploreEditorialReference):Entry {
  return {key:reference.id,image:reference.imageUrl,title:reference.title,description:reference.description,href:reference.href,reference};
}
export function EditorialHeading({title,description,action}:{title:string;description?:string;action?:ReactNode}) {
  return <header className={styles.heading}><div><h2>{title}</h2>{description?<p className={styles.description}>{description}</p>:null}</div>{action}</header>;
}
function EntryPhoto({entry,onOpen,onOpenFeed,priority=false}:{entry:Entry;onOpen:(item:ExploreInspirationItem)=>void;onOpenFeed?:(item:ExploreFeedItem)=>void;priority?:boolean}) {
  useSalonSocial(entry.look?.salonId);
  const content=<>{entry.image?<Image src={entry.image} alt={entry.feed?entry.title:entry.look?`${entry.title} — ${entry.look.salonName}`:`${entry.title} — AI illustration by ReyLUMI`} fill sizes="(min-width:1280px) 45vw, (min-width:768px) 50vw, 100vw" priority={priority} className="object-cover"/>:null}{entry.feed?<NailIllustrationCredit imageUrl={entry.image} className={styles.credit}/>:null}{entry.reference && entry.image?<LumiAiWatermark className={styles.credit}/>:null}</>;
  return entry.feed?<button type="button" className={styles.photo} onClick={()=>onOpenFeed?.(entry.feed!)} aria-label={`Open post from ${entry.description}`}>{content}</button>:entry.look?<button type="button" className={styles.photo} onClick={()=>onOpen(entry.look!)} aria-label={`Open ${entry.title} from ${entry.look.salonName}`}>{content}</button>:<Link prefetch={false} href={entry.href} className={styles.photo}>{content}</Link>;
}
function EntryTile({entry,onOpen,onOpenFeed,viewer,priority=false,compact=false,commentPresentation}:{entry:Entry;onOpen:(item:ExploreInspirationItem)=>void;onOpenFeed:(item:ExploreFeedItem)=>void;viewer:PostCommentViewer;priority?:boolean;compact?:boolean;commentPresentation?:ExploreCommentPresentation}) {
  const [count,setCount]=useState(entry.feed?.commentCount??0);
  return <article className={styles.tile} data-editorial-reference={entry.reference?.kind} data-compact-post={compact || undefined}>
    <EntryPhoto entry={entry} onOpen={onOpen} onOpenFeed={onOpenFeed} priority={priority}/>
    {entry.feed?<ExploreFeedCard commentPresentation={commentPresentation} showMedia={false} inlineComments={!compact} onOpenComments={compact?()=>onOpenFeed(entry.feed!):undefined} item={{...entry.feed,commentCount:count,caption:compact?exploreCaptionExcerpt(entry.feed.caption,entry.description):entry.feed.caption}} viewer={viewer} onCommentCountChange={(_,value)=>setCount(value)}/>:entry.look?<ExploreInspirationPost commentPresentation={commentPresentation} showMedia={false} inlineComments={!compact} onOpenComments={compact?()=>onOpen(entry.look!):undefined} item={entry.look} viewer={viewer}/>:<div className={styles.caption}><h3><Link prefetch={false} href={entry.href}>{entry.title}</Link></h3></div>}
  </article>;
}

/** Presentation only: reuse the filtered, loaded photos and the existing reference catalog. */
export function ExploreLookEditorial({looks,posts=[],viewer,category,location,onExplore,onOpen,mode="fresh"}:{looks:ExploreInspirationItem[];posts?:ExploreFeedItem[];viewer:PostCommentViewer;category:string;location:string;onExplore:()=>void;onOpen:(item:ExploreInspirationItem)=>void;mode?:"fresh"|"recommended"}) {
  const social=useExploreSocial();
  const [openedPost,setOpenedPost]=useState<ExploreFeedItem|null>(null);
  const eligible=looks.filter(look=>look.imageUrl?.trim() && !social.states[look.salonId]?.hidden).filter((look,index,all)=>all.findIndex(other=>other.imageUrl===look.imageUrl)===index);
  const start=mode === "fresh" ? 0 : 3;
  const source=posts.length ? posts.filter(post=>!post.salon || !social.states[post.salon.id]?.hidden).map(feedEntry) : eligible.map(lookEntry);
  const commentPlan=useExploreCommentPresentation(source.map((entry,index)=>entry.feed?feedCommentCandidate(entry.feed,editorialCommentOptions(index)):entry.look?lookCommentCandidate(entry.look,editorialCommentOptions(index)):null));
  const candidateKey=(entry:Entry)=>(entry.feed?feedCommentCandidate(entry.feed):entry.look?lookCommentCandidate(entry.look):null)?.key;
  const presentation=(entry:Entry)=>{
    const key=candidateKey(entry);
    // A look can have several media tiles; decorate only its first occurrence.
    if(!key || source.find(other=>candidateKey(other)===key)?.key!==entry.key)return undefined;
    return commentPlan[key];
  };
  const real=source.slice(start,start+3);
  const references=exploreEditorialReferences(category,location,Math.max(0,6-source.length),source.map(entry=>entry.image)).map(referenceEntry);
  const entries=real.concat(references.slice(mode === "fresh"?0:Math.max(0,3-source.length))).slice(0,3);
  if(!entries.length)return null;
  const featured=entries[0];
  return <section className={styles.section} data-testid={mode === "fresh"?"explore-fresh-editorial":"explore-recommended-editorial"}>
    <EditorialHeading title={mode === "fresh"?"Fresh looks":"Recommended for you"} description={mode === "fresh"?"Inspiration for your next appointment.":undefined} action={mode === "fresh"?<button type="button" className={styles.link} onClick={onExplore}>Explore looks <span aria-hidden>→</span></button>:undefined}/>
    {mode === "fresh"?<div className={styles.mosaic} data-count={entries.length}>{entries.map((entry,index)=><EntryTile commentPresentation={presentation(entry)} key={entry.key} entry={entry} onOpen={onOpen} onOpenFeed={setOpenedPost} viewer={viewer} priority={index===0} compact={index>0}/>)}</div>:<div className={styles.recommended}>
      <div className={styles.featuredPost}><EntryPhoto entry={featured} onOpen={onOpen} onOpenFeed={setOpenedPost}/>{featured.feed?<ExploreFeedCard commentPresentation={presentation(featured)} showMedia={false} showCaption={false} inlineComments={false} onOpenComments={()=>setOpenedPost(featured.feed!)} item={featured.feed} viewer={viewer} onCommentCountChange={()=>{}}/>:featured.look?<ExploreInspirationPost commentPresentation={presentation(featured)} showMedia={false} showCaption={false} inlineComments={false} onOpenComments={()=>onOpen(featured.look!)} item={featured.look} viewer={viewer}/>:null}</div>
      <div className={styles.story}><p className={styles.eyebrow}>{featured.feed?.platformIntroduction?"Introduction by Reylumi":featured.look || featured.feed?"Looks near you":"Style inspiration"}</p><p className={styles.excerpt} data-editorial-excerpt>{exploreCaptionExcerpt(featured.title,featured.description)}</p>
        <div className="flex flex-wrap items-center gap-3">{featured.feed?<button type="button" className={styles.link} onClick={()=>setOpenedPost(featured.feed!)}>Explore this post <span aria-hidden>→</span></button>:featured.look?<button type="button" className={styles.link} onClick={()=>onOpen(featured.look!)}>Explore this look <span aria-hidden>→</span></button>:<Link prefetch={false} className={styles.link} href={featured.href}>Explore this style <span aria-hidden>→</span></Link>}{featured.look?<SavePostButton target={featured.look.saveTarget} initialSaved={featured.look.saveTarget.saved}/>:null}</div>
        {entries.length>1?<div className={styles.thumbnails}>{entries.slice(1).map(entry=><EntryTile commentPresentation={presentation(entry)} key={entry.key} entry={entry} onOpen={onOpen} onOpenFeed={setOpenedPost} viewer={viewer} compact/>)}</div>:null}
      </div>
    </div>}
    {openedPost ? openedPost.sourceType === "salon" && openedPost.salon && openedPost.media.length && (openedPost.contentType === "look" || openedPost.contentType === "update")
      ? <SalonFeedPostPreview key={openedPost.feedKey} item={openedPost} viewer={viewer} onClose={()=>setOpenedPost(null)} />
      : <ContentViewer onClose={()=>setOpenedPost(null)} aria-label="Explore post"><div className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto bg-white p-4"><button type="button" onClick={()=>setOpenedPost(null)} className="sticky top-0 z-10 ml-auto block rounded-full bg-white px-4 py-3" aria-label="Close post">×</button><ExploreFeedCard openCommentsInitially item={openedPost} viewer={viewer} onCommentCountChange={(_,count)=>setOpenedPost({...openedPost,commentCount:count})}/></div></ContentViewer> : null}
  </section>;
}

export function ExploreSalonDirectory({salons,category,location}:{salons:ExploreSearchResult[];category:string;location:string}) {
  const social=useExploreSocial();
  const visible=salons.filter(salon=>!social.states[salon.id]?.hidden).slice(0,3);
  if(!visible.length)return null;
  return <section className={styles.section} data-testid="explore-salon-directory"><EditorialHeading title="Salons to explore" action={<Link prefetch={false} className={styles.link} href={exploreEditorialHref(category,location,"","salons")}>View all <span aria-hidden>→</span></Link>}/><div className={styles.directory}>{visible.map(salon=><ExploreSalonCard key={salon.id} salon={salon} presentation="directory"/>)}</div></section>;
}

export function ExploreBookingEditorial({salons,contactSalons,category,location}:{salons:ExploreSearchResult[];contactSalons:ExploreSearchResult[];category:string;location:string}) {
  const social=useExploreSocial();
  const [failed,setFailed]=useState(false);
  const options=[...salons,...contactSalons].filter((salon,index,all)=>!social.states[salon.id]?.hidden&&all.findIndex(other=>other.id===salon.id)===index).slice(0,3);
  const guides=exploreServiceGuides(category,location);
  const primary=options[0];
  const fallback=primary?resolveNailCoverImage({id:primary.id,name:primary.name,categories:primary.serviceCategories}):guides[0]?.imageUrl;
  const photo=(!failed&&primary?.coverImageUrl)||fallback;
  return <section className={styles.section} data-testid="explore-booking-editorial"><EditorialHeading title="Booking options" description="Choose a service and explore your next visit."/>
    <div className={styles.booking}>
      {photo?<div className={`${styles.photo} ${styles.bookingPhoto}`}><Image src={photo} alt={isDefaultNailImage(photo)?"AI service illustration by ReyLUMI":`${primary?.name ?? category} salon`} fill sizes="(min-width:768px) 35vw, 100vw" className="object-cover" onError={()=>setFailed(true)}/><NailIllustrationCredit imageUrl={photo} className={styles.credit}/></div>:null}
      <div className={styles.services}>
        {options.length?options.map(salon=><div className={styles.service} key={salon.id}><div><h3>{salon.bookableServiceName || salon.featuredServiceName || salon.serviceNames?.[0] || "Explore services"}</h3><p>{salon.name}</p></div>{salon.bookingEnabled && salon.bookingHref?<ExploreBookButton href={salon.bookingHref} name={salon.name} contactHref={salon.hasPublicProfile?`/explore/salons/${salon.id}`:null} phoneHref={salon.phone?`tel:${salon.phone}`:null}/>:<Link prefetch={false} className={styles.link} href={salon.hasPublicProfile?`/explore/salons/${salon.id}`:salon.phone?`tel:${salon.phone}`:exploreEditorialHref(category,location)}>View services <span aria-hidden>→</span></Link>}</div>):guides.map(guide=><Link prefetch={false} className={styles.service} href={guide.href} key={guide.id}><div><h3>{guide.title}</h3></div><span className={styles.link}>Explore <span aria-hidden>→</span></span></Link>)}
        <Link prefetch={false} href={exploreEditorialHref(category,location,"","salons")} className={styles.bookingAction}>Find a salon</Link>
      </div>
    </div>
  </section>;
}
