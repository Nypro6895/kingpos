"use client";
import Image from "next/image";
import {useState} from "react";
import {rewardNailIllustration} from "@/lib/reward-invitation";
import type {RewardDiscoverySalon} from "@/lib/reward-discovery";
import styles from "./reward-discovery.module.css";

export function RewardPromoArtwork({salon,category=""}:{salon:RewardDiscoverySalon;category?:string}){
 const [failed,setFailed]=useState<string[]>([]);
 const cover=salon.coverImageSource==="salon"?salon.coverImageUrl:null;
 const source=cover&&!failed.includes(cover)?cover:rewardNailIllustration(salon,category)?"/images/rewards/nail-care-rewards-v1.webp":null;
 if(source&&!failed.includes(source))return <Image src={source} alt={source===cover?`Public cover from ${salon.name}`:"Illustrative nail-care rewards promotion"} width={1536} height={1024} sizes="(max-width: 464px) calc(100vw - 24px), 440px" unoptimized={source===cover} onError={()=>setFailed(old=>[...old,source])}/>;
 return <div className={styles.rewardArtwork}><svg viewBox="0 0 240 140" role="img" aria-label="Salon rewards illustration"><g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M78 65h84v54H78zM72 48h96v19H72zM120 48v71"/><path d="M120 48C88 48 82 22 99 22c13 0 21 26 21 26s8-26 21-26c17 0 11 26-21 26Z"/><path d="M47 45v12m-6-6h12M192 91v12m-6-6h12M182 24v8m-4-4h8"/></g></svg></div>;
}
