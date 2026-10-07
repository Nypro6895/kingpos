"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PublicSalonProfileStaff } from "@/types/salon-profile";
import { preloadQuickBooking } from "@/lib/quick-booking-client";
import styles from "./team-menu.module.css";

export function TeamMenu({members,canBook,bookingHref,onOpen}: {
  members: PublicSalonProfileStaff[];
  canBook: boolean;
  bookingHref: (staffId:string)=>string;
  onOpen: (member:PublicSalonProfileStaff)=>void;
}) {
  const [selected,setSelected]=useState<string|null>(null);
  const root=useRef<HTMLUListElement>(null);
  const id=useId();
  useEffect(()=>{
    function dismiss(event:PointerEvent) {
      const target=event.target as Element;
      if(target.closest('[data-team-row], dialog, [role="dialog"]'))return;
      setSelected(null);
    }
    function escape(event:KeyboardEvent) {
      if(event.key!=="Escape" || document.querySelector('dialog[open], [role="dialog"]'))return;
      root.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
      setSelected(null);
    }
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[]);
  return <ul ref={root} className={styles.list}>{members.map(member=>{
    const open=selected===member.id;
    const bookable=canBook && member.onlineBookingEnabled;
    return <li key={member.id} className={styles.item} data-team-row>
      <button type="button" className={styles.row} aria-expanded={open} aria-controls={`${id}-${member.id}`} onClick={()=>{
        setSelected(open?null:member.id);
        if(!open && bookable)preloadQuickBooking(bookingHref(member.id));
      }}>
        <span className={styles.avatar} aria-hidden="true">{member.avatarUrl ?
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatarUrl} alt="" loading="lazy"/> : member.displayName.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('')}</span>
        <span className={styles.identity}><strong>{member.displayName}</strong>{member.jobTitle?<small>{member.jobTitle}</small>:null}</span>
        <svg className={open?styles.open:undefined} aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open?<div id={`${id}-${member.id}`} className={styles.expanded}>
        {member.specialties.length?<p>{member.specialties.join(' · ')}</p>:null}
        {member.bio?<p>{member.bio}</p>:null}
        <div className={styles.actions}>
          <button type="button" onClick={()=>onOpen(member)}>View profile</button>
          {bookable?<a href={bookingHref(member.id)} aria-label={`Book with ${member.displayName}`}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 5 3 3 5-5"/></svg>Book
          </a>:<span>Online booking unavailable</span>}
        </div>
      </div>:null}
    </li>;
  })}</ul>;
}
