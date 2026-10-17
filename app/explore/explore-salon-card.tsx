"use client";
import { useState } from "react";
import Link from "next/link";
import { ExploreViewportImage as Image } from "./explore-viewport-image";
import { ExploreSalonFollow, ExploreSalonMenu, ExploreSocialActions, useSalonSocial } from "@/components/explore-social";
import { isSalonId } from "@/lib/explore-social";
import { isDefaultNailImage, resolveNailCoverImage } from "@/lib/default-nail-images";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";
import { SalonVerifiedBadge } from "@/components/salon-trust-line";
import styles from "./explore-salon-card.module.css";

type Salon = { id:string;name:string;coverImageUrl:string|null;logoImageUrl?:string|null;city:string|null;state:string|null;addressLine1?:string|null;addressLine2?:string|null;postalCode?:string|null;serviceCategories:string[];bookingEnabled:boolean;bookingHref:string|null;phone?:string|null;identityVerified?:boolean;hasPublicProfile?:boolean;imageProvenance?:"salon_post"|"customer_post"|"salon_cover"|"suggested"|"none";imageSourceSalonId?:string|null;mediaRevision?:string|null };
export function ExploreSalonCard({ salon, compact = false, presentation = "card" }: { salon:Salon;compact?:boolean;presentation?:"card"|"directory" }) {
  const [failedImage,setFailedImage]=useState<string|null>(null),social=useSalonSocial(salon.id);
  const href=isSalonId(salon.id)?`/explore/salons/${salon.id}`:salon.bookingHref??"/explore";
  const imageKey=`${salon.id}:${salon.coverImageUrl ?? ""}:${salon.mediaRevision ?? ""}`;
  const mismatchedOwner=(salon.imageProvenance==="salon_post"||salon.imageProvenance==="customer_post"||salon.imageProvenance==="salon_cover")&&salon.imageSourceSalonId!==salon.id;
  const useFallback=failedImage===imageKey||mismatchedOwner||!salon.coverImageUrl;
  const image=useFallback?resolveNailCoverImage({id:salon.id,name:salon.name,categories:salon.serviceCategories}):salon.coverImageUrl;
  const suggested=Boolean(image&&(useFallback||salon.imageProvenance==="suggested"||isDefaultNailImage(image)||image.startsWith("/inspiration/nails/")));
  const address=[salon.addressLine1,salon.addressLine2,salon.city,salon.state,salon.postalCode].filter(Boolean).join(", ");
  const target={...salon,href,address,bookingHref:salon.bookingEnabled?salon.bookingHref:null};
  if(social.state.hidden)return null;
  return <article className={`${styles.card} ${compact?styles.compact:""} ${presentation==="directory"?styles.directory:""}`} data-testid="explore-salon-card" data-salon-id={salon.id}>
    <Link prefetch={false} href={href} className={styles.photo} aria-label={`View ${salon.name}`}>
      {image?<Image src={image} alt={suggested?`Suggested image for ${salon.name}; not actual salon work`:`${salon.name} salon photo`} fill sizes="(max-width:640px) 100vw, (max-width:1280px) 50vw, 33vw" className="object-cover" onError={()=>setFailedImage(imageKey)}/>:<span>{salon.name}</span>}
      <NailIllustrationCredit imageUrl={image} className="absolute bottom-2 right-2"/>
      {suggested?<span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Suggested image</span>:null}
    </Link>
    <div className={styles.body}>
      <div className={styles.header} data-salon-header>
        <Link prefetch={false} href={href} className={styles.avatar} aria-label={`${salon.name} profile`}>{salon.logoImageUrl?<Image src={salon.logoImageUrl} alt="" fill sizes="36px" className="object-cover"/>:salon.name.split(/\s+/).slice(0,2).map(word=>word[0]).join("")}</Link>
        <div className={styles.identity}>
          <div className={styles.nameRow}><Link prefetch={false} href={href} title={salon.name} className={styles.name}>{salon.name}</Link><SalonVerifiedBadge verified={salon.identityVerified}/><ExploreSalonFollow salon={target}/></div>
          <p className={styles.location}>{[salon.serviceCategories[0],salon.city,salon.state].filter(Boolean).join(" · ")}</p>
        </div>
        <ExploreSalonMenu salon={target}/>
      </div>
      {address?<p className={styles.address}>{address}</p>:null}
      <ExploreSocialActions salon={target} href={href}/>
    </div>
  </article>;
}
