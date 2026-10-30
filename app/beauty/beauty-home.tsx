"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { BeautyProfileSummary, BeautyTimelinePost } from "@/types/beauty";
import { BeautyQuickQr } from "./beauty-quick-qr";
import "./beauty-home.css";
import { BeautyHomeIcon } from "./beauty-home-icon";

export function BeautyHome({ profile, posts, viewerId, appointment, favorites, onCompose }: {
  profile: BeautyProfileSummary;
  posts: BeautyTimelinePost[];
  viewerId: string | null;
  appointment?: ReactNode;
  favorites?: ReactNode;
  onCompose: (photo: boolean) => void;
}) {
  const photos = posts.flatMap(post => post.media).filter(media => media.url).slice(0, 3);
  return <div className="beauty-home" data-beauty-home>
    <header className="beauty-home-greeting">
      <p className="beauty-home-hello">Hello,</p>
      <div className="beauty-home-name-row">
        <div className="beauty-home-person">
          <Link href="/beauty/library" aria-label="Open your Beauty profile" className="beauty-home-avatar">
            {profile.avatarUrl ? <Image src={profile.avatarUrl} alt="" width={48} height={48}/> : <span>{profile.initials}</span>}
          </Link>
          <h1>{profile.displayName}</h1>
        </div>
        {viewerId ? <BeautyQuickQr viewerId={viewerId} profile={profile}/> : <Link className="beauty-home-qr-trigger" href="/qr"><BeautyHomeIcon name="qr"/>My QR</Link>}
      </div>
    </header>
    <div className="beauty-home-compose" aria-label="Create a Beauty post">
      <button className="beauty-home-compose-prompt" type="button" onClick={() => onCompose(false)}>What would you like to post?</button>
      <button type="button" aria-label="Write a Beauty post" onClick={() => onCompose(false)}><BeautyHomeIcon name="write"/></button>
      <button type="button" aria-label="Post a Beauty photo" onClick={() => onCompose(true)}><BeautyHomeIcon name="photo"/></button>
    </div>
    <section className="beauty-home-rewards" aria-label="My Rewards, coming soon">
      <div><h2>My Rewards</h2><p>Coming soon</p></div>
      <div className="beauty-home-reward-art" aria-hidden="true"><span className="beauty-home-pedestal"/><span className="beauty-home-star">✦</span><span className="beauty-home-star-small">✦</span><span className="beauty-home-sparkle">✧</span></div>
    </section>
    <section className="beauty-home-bookings" aria-labelledby="beauty-bookings-title">
      <div className="beauty-home-section-heading"><h2 id="beauty-bookings-title">My Bookings</h2><Link href="/my-bookings">See all</Link></div>
      {appointment}
    </section>
    <section aria-labelledby="beauty-favorites-title">
      <div className="beauty-home-section-heading"><h2 id="beauty-favorites-title">My Favorites</h2><Link href="/more/saved-post">See all</Link></div>
      {favorites}
    </section>
    <Link href="/beauty/library" className="beauty-home-library">
      <div className="beauty-home-library-previews" aria-hidden="true">{photos.length ? photos.map(media => <Image key={media.id} src={media.url!} alt="" width={56} height={62}/>) : <BeautyHomeIcon name="photo"/>}</div>
      <div><h2>My Beauty Library</h2><p>Your posts &amp; photos</p></div><BeautyHomeIcon name="arrow"/>
    </Link>
  </div>;
}
