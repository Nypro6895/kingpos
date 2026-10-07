"use client";
/* eslint-disable @next/next/no-img-element -- Preserve public URLs for salon-uploaded media. */
import { useState, type CSSProperties, type ReactNode, type ImgHTMLAttributes } from "react";
import type { ProfileFeedItem, PublicSalonProfileData, PublicSalonProfileService, PublicSalonProfileStaff, PublicSalonProfileExperience } from "@/types/salon-profile";
import type { SalonProfilePreferences } from "@/lib/salon-profile-preferences";
import { OperatingHoursDisplay } from "./operating-hours-display";
import { preloadQuickBooking } from "@/lib/quick-booking-client";
import { PostActions } from "./post-actions";
import styles from "./salon-website-home.module.css";
import { salonAboutParagraphs, visibleSalonPosts } from "@/lib/salon-profile-content";
import { isDefaultNailImage } from "@/lib/default-nail-images";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";
import { WebsitePhotoFeed, selectWebsiteFeedPhotos, type WebsiteLibraryPhoto } from "./website-photo-feed";

export function websitePhotoGeometry(width: number, height: number) {
  const ratio = width > 0 && height > 0 ? width / height : 1;
  return { ratio, orientation: ratio < 0.9 ? "portrait" : ratio > 1.1 ? "landscape" : "square" };
}

function WebsiteImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [geometry, setGeometry] = useState<{src: ImgHTMLAttributes<HTMLImageElement>["src"]; ratio: number; orientation: string} | null>(null);
  const current = geometry?.src === props.src ? geometry : null;
  return <img {...props} alt={props.alt ?? ""} data-orientation={current?.orientation ?? "pending"}
    style={{...props.style, "--photo-ratio": current?.ratio ?? 1.5} as CSSProperties}
    onLoad={event => {
      const image = event.currentTarget;
      setGeometry({src: props.src, ...websitePhotoGeometry(image.naturalWidth, image.naturalHeight)});
      props.onLoad?.(event);
    }} />;
}

export function selectCustomerReviewHighlights(data: Pick<PublicSalonProfileData,"experiences" | "reviews">, count: 2 | 3 = 3) {
  const feedback: PublicSalonProfileExperience[] = data.experiences?.length ? data.experiences : (data.reviews ?? []).map(review=>({...review,feedbackState:"legacy" as const,issueStatus:null,source:"legacy_review" as const,ticketId:null}));
  const seen = new Set<string>();
  return [...feedback].filter(review=>review.body?.trim() && review.feedbackState !== "issue" && ((review.rating !== null && review.rating >= 4) || (review.rating === null && review.feedbackState === "good")))
    .sort((a,b)=>(b.rating ?? 0)-(a.rating ?? 0) || Number(b.verificationStatus === "verified")-Number(a.verificationStatus === "verified") || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .filter(review=>{const key=review.authorUserId || review.id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,count);
}

export function selectWebsitePhotos(posts: ProfileFeedItem[], selectedId?: string | null, failedImages: string[] = [], useHero = true, unsuitableHeroImages: string[] = []) {
  const available = posts.filter(post=>post.contentType === "look" && post.publishedAt && post.imageUrl && !failedImages.includes(post.imageUrl) && !unsuitableHeroImages.includes(post.imageUrl) && !isDefaultNailImage(post.imageUrl));
  const ranked = [...available].sort((a,b)=>((b.contentType === "look" ? b.saveCount : 0) || 0)+(b.commentCount || 0)-((a.contentType === "look" ? a.saveCount : 0) || 0)-(a.commentCount || 0) || (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "") || a.id.localeCompare(b.id));
  const featured = available.find(post=>post.isPinned) ?? available.find(post=>post.id === selectedId) ?? ranked[0];
  const chronological = [...posts].sort((a,b)=>(b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const usedUrls = new Set<string>(useHero && featured?.imageUrl ? [featured.imageUrl] : []);
  const latest = chronological.filter(post=>{
    if(useHero && post.id === featured?.id)return false;
    if(post.imageUrl && !failedImages.includes(post.imageUrl)){if(usedUrls.has(post.imageUrl))return false;usedUrls.add(post.imageUrl);}
    return true;
  }).slice(0,3);
  // Only mark photos from posts actually shown, so older work remains available.
  const visibleUrls = new Set([...(useHero && featured?.imageUrl ? [featured.imageUrl] : []),...latest.map(post=>post.imageUrl).filter(Boolean)]);
  const photos = useHero && featured ? [featured,...available.filter(post=>post.id !== featured.id && !visibleUrls.has(post.imageUrl)).sort((a,b)=>(a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))].filter(post=>{if(post === featured)return true;if(visibleUrls.has(post.imageUrl))return false;visibleUrls.add(post.imageUrl);return true;}).slice(0,3) : [];
  return {featured,latest,photos};
}

type BookContext = { title: string; serviceId?: string; staffId?: string };
type WebsiteProps = {
  data: PublicSalonProfileData;
  preferences: SalonProfilePreferences;
  posts: ProfileFeedItem[];
  composer?: ReactNode;
  canBook: boolean;
  renderPostActions?: (post: ProfileFeedItem) => ReactNode;
  libraryPhotos?: WebsiteLibraryPhoto[];
  onLibraryPhoto?: (photo: WebsiteLibraryPhoto) => void;
  renderLibraryActions?: (photo: WebsiteLibraryPhoto) => ReactNode;
  onReviews?: () => void;
  onStaff?: (member: PublicSalonProfileStaff) => void;
  onPost: (post: ProfileFeedItem) => void;
  onGallery: () => void;
  onServices: () => void;
  onTeam: () => void;
  onBook: (context: BookContext) => void;
};

export function SalonWebsiteHome({ data, preferences, posts, composer, canBook, onPost, onGallery, onServices, onTeam, onBook, onStaff, onReviews, renderPostActions, libraryPhotos, onLibraryPhoto, renderLibraryActions }: WebsiteProps) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [unsuitableHeroImages, setUnsuitableHeroImages] = useState<string[]>([]);
  const imageFailed = (url: string) => setFailedImages(previous => previous.includes(url) ? previous : [...previous, url]);
  const hasImage = (post: ProfileFeedItem) => Boolean(post.imageUrl && !failedImages.includes(post.imageUrl));
  const visiblePosts = visibleSalonPosts(posts, data.directoryListing).filter(post => post.publishedAt && (post.imageUrl || post.title?.trim() || post.caption?.trim()));
  const showFeature = preferences.show_featured !== false;
  const useHero = showFeature && preferences.layout !== "booking";
  const { featured, latest } = selectWebsitePhotos(visiblePosts, data.websiteFeaturedLookId, failedImages, useHero, unsuitableHeroImages);
  const heroPost = useHero ? featured : undefined;
  const coverUrl = !heroPost && useHero && data.profile.coverImageUrl && !isDefaultNailImage(data.profile.coverImageUrl)
    && !failedImages.includes(data.profile.coverImageUrl) && !unsuitableHeroImages.includes(data.profile.coverImageUrl) ? data.profile.coverImageUrl : null;
  const heroUrl = heroPost?.imageUrl || coverUrl;
  const servicePreview = preferences.show_services ? data.services.slice(0, 4) : [];
  const showServices = servicePreview.length > 0;
  const showTeam = preferences.show_team && data.staff.length > 0;
  const address = [data.profile.addressLine1, data.profile.addressLine2, data.profile.city, data.profile.state, data.profile.postalCode].filter(Boolean).join(", ");
  const locality = [data.profile.city, data.profile.state].filter(Boolean).join(", ");
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const hasHours = Boolean(data.operatingHours?.weeklyHours.length || data.operatingHours?.specialHours.length);
  const showVisit = Boolean(data.profile.addressLine1 || data.profile.phone || hasHours);
  const paragraphs = salonAboutParagraphs(data.profile);
  const intro = paragraphs[0];
  const aboutParagraphs = showFeature && intro && intro.length <= 220 ? paragraphs.slice(1) : paragraphs;
  const reviews = preferences.show_customer_reviews !== false ? selectCustomerReviewHighlights(data, preferences.customer_review_count ?? 3) : [];

  // Reserve only images actually rendered above the continuation feed.
  const displayedUrls = new Set(latest.filter(hasImage).map(post => post.imageUrl!).concat(heroUrl ? [heroUrl] : []));
  if (showServices && preferences.layout === "balanced") for (const service of servicePreview) {
    const url = visiblePosts.find(post => post.serviceId === service.id && hasImage(post) && !isDefaultNailImage(post.imageUrl))?.imageUrl;
    if (url) displayedUrls.add(url);
  }
  const library = libraryPhotos ?? visiblePosts.map(post => ({ id: `${post.contentType}-${post.id}`, imageUrl: post.imageUrl ?? "", title: post.title, publishedAt: post.publishedAt }));
  const galleryAvailable = library.some(photo => photo.publishedAt && photo.imageUrl && !failedImages.includes(photo.imageUrl));
  const feedPhotos = selectWebsiteFeedPhotos(library.filter(photo => !failedImages.includes(photo.imageUrl) && !isDefaultNailImage(photo.imageUrl)), [...displayedUrls]);
  const openLibraryPhoto = (photo: WebsiteLibraryPhoto) => {
    if (onLibraryPhoto) return onLibraryPhoto(photo);
    const post = posts.find(post => `${post.contentType}-${post.id}` === photo.id);
    if (post) onPost(post);
  };
  const libraryActions = renderLibraryActions ?? (renderPostActions ? (photo: WebsiteLibraryPhoto) => {
    const post = posts.find(post => `${post.contentType}-${post.id}` === photo.id);
    return post ? renderPostActions(post) : null;
  } : undefined);
  const rejectSmallHero = (url: string, image: HTMLImageElement) => {
    const ratio = image.naturalWidth / image.naturalHeight;
    if (Math.max(image.naturalWidth, image.naturalHeight) < 480 || Math.min(image.naturalWidth, image.naturalHeight) < 240 || ratio < 0.5 || ratio > 2.6) {
      setUnsuitableHeroImages(previous => previous.includes(url) ? previous : [...previous, url]);
    }
  };

  const desktopRows: string[] = [];
  const mobileRows: string[] = [];
  const full = (area: string) => `${area} ${area} ${area}`;
  if (composer) { desktopRows.push(full("composer")); mobileRows.push("composer"); }
  if (showFeature) { desktopRows.push(full("feature")); mobileRows.push("feature"); }
  const content: [string, boolean][] = preferences.layout === "portfolio"
    ? [["latest", latest.length > 0], ["services", showServices], ["reviews", reviews.length > 0], ["team", showTeam], ["about", aboutParagraphs.length > 0]]
    : [["services", showServices], ["latest", latest.length > 0], ["reviews", reviews.length > 0], ["team", showTeam], ["about", aboutParagraphs.length > 0]];
  const present = content.filter(([, visible]) => visible).map(([area]) => area);
  const wideVisit = preferences.layout === "portfolio" || (present.length < 2 && servicePreview.length < 3);
  if (!wideVisit && showVisit && present.length) {
    present.forEach((area, index) => desktopRows.push(index < 2 ? `${area} ${area} hours` : full(area)));
  } else {
    present.forEach(area => desktopRows.push(full(area)));
    if (showVisit) desktopRows.push(full("hours"));
  }
  present.forEach(area => mobileRows.push(area));
  if (showVisit) {
    const afterServices = mobileRows.indexOf("services");
    mobileRows.splice(preferences.layout === "portfolio" ? mobileRows.length : afterServices >= 0 ? afterServices + 1 : showFeature ? (composer ? 2 : 1) : (composer ? 1 : 0), 0, "hours");
  }
  if (feedPhotos.length) { desktopRows.push(full("photoFeed")); mobileRows.push("photoFeed"); }
  desktopRows.push(full("footer")); mobileRows.push("footer");
  const gridStyle = { "--website-desktop-areas": desktopRows.map(row => `"${row}"`).join(" "), "--website-mobile-areas": mobileRows.map(row => `"${row}"`).join(" ") } as CSSProperties;
  const heading = (title: string, action?: () => void, label = "View all") => <header className={styles.heading}><h3>{title}</h3>{action ? <button type="button" onClick={action}>{label} <span aria-hidden="true">→</span></button> : null}</header>;
  const visitTitle = preferences.layout === "booking" ? "Plan your visit" : preferences.layout === "portfolio" ? "Visit the studio" : "Visit us";
  return <div className={styles.home} data-layout={preferences.layout} data-owner={Boolean(composer)} data-services={showServices} data-team={showTeam} data-has-photos={Boolean(heroUrl)} data-photo-count={heroUrl ? 1 : 0} style={gridStyle}>
    {composer ? <div className={styles.composer}>{composer}</div> : null}
    {showFeature ? <section className={styles.feature} data-has-image={Boolean(heroUrl)} aria-label="Salon introduction">
      <div className={styles.welcome}>
        <p className={styles.eyebrow}>{locality || "Welcome"}</p>
        <h2>{data.profile.tagline?.trim() || data.profile.name}</h2>
        {intro ? <p className={styles.intro}>{intro.length > 220 ? `${intro.slice(0, 217).trimEnd()}…` : intro}</p> : null}
        <div className={styles.heroActions}>
          {canBook ? <button className={styles.book} type="button" onClick={() => onBook({ title: "Book appointment" })}>Book appointment <span aria-hidden="true">→</span></button> : null}
          {data.profile.phone ? <a className={styles.secondary} href={`tel:${data.profile.phone}`}>Call salon</a> : data.profile.addressLine1 ? <a className={styles.secondary} href={directions} target="_blank" rel="noreferrer">Get directions ↗</a> : null}
        </div>
      </div>
      {heroUrl ? <div className={styles.mosaic}>{heroPost || galleryAvailable ? <button type="button" aria-label={heroPost ? `Open ${heroPost.title || "featured work"}` : "View salon gallery"} onClick={() => heroPost ? onPost(heroPost) : onGallery()}>
        <WebsiteImage src={heroUrl} alt={heroPost?.title || `${data.profile.name} salon`} onLoad={event => rejectSmallHero(heroUrl, event.currentTarget)} onError={() => imageFailed(heroUrl)}/>
      </button> : <div className={styles.heroImage}><WebsiteImage src={heroUrl} alt={`${data.profile.name} salon`} onLoad={event => rejectSmallHero(heroUrl, event.currentTarget)} onError={() => imageFailed(heroUrl)}/></div>}</div> : <div className={styles.heroDecoration} aria-hidden="true"><span>{data.profile.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</span></div>}
    </section> : null}
    {showServices ? <section className={styles.services}>{heading("Services", onServices, "View all services")}<WebsiteServices services={servicePreview} posts={visiblePosts} canBook={canBook} onBook={onBook} salonId={data.profile.salonId} showPhotos={preferences.layout === "balanced"}/></section> : null}
    {showVisit ? <section className={styles.hours} data-wide={wideVisit}>{heading(visitTitle)}
      {data.profile.addressLine1 ? <div className={styles.visitItem}><span aria-hidden="true">↗</span><div><p>{address}</p><a href={directions} target="_blank" rel="noreferrer">Get directions ↗</a></div></div> : null}
      {data.profile.phone ? <div className={styles.visitItem}><span aria-hidden="true">☎</span><div><p>{data.profile.phone}</p><a href={`tel:${data.profile.phone}`}>Call salon</a></div></div> : null}
      {hasHours ? <div className={styles.schedule}><h4>Opening hours</h4><OperatingHoursDisplay salonId={data.profile.salonId} initialSettings={data.operatingHours} compact/></div>
        : data.profile.phone ? <p className={styles.hoursHint}>Call to confirm opening hours.</p> : null}
    </section> : null}
    {latest.length ? <section className={styles.latest}>{heading(data.directoryListing?.claimState === "unclaimed" ? "Reference introduction" : preferences.layout === "portfolio" ? "Selected work & updates" : "Latest from the salon", galleryAvailable ? onGallery : undefined, "View gallery")}
      <div className={styles.recent} data-count={latest.length} data-reference-listing={latest.length === 1 && latest[0].id === data.directoryListing?.referencePostId}>{latest.map(post => <article key={`${post.contentType}-${post.id}`} className={styles.post} data-has-image={hasImage(post)}>
        <button id={`${post.contentType}-${post.id}`} type="button" className={styles.postOpen} onClick={() => onPost(post)}>
          {hasImage(post) ? <div className={styles.postMedia}><WebsiteImage src={post.imageUrl!} alt={post.title || "Salon post"} loading="lazy" onError={() => imageFailed(post.imageUrl!)}/><NailIllustrationCredit imageUrl={post.imageUrl} className={styles.imageCredit}/></div> : null}
          <div className={styles.postBody}><strong>{post.title || post.caption || "Salon update"}</strong>
            {post.caption && post.caption !== post.title ? <p className={styles.clamp}>{post.caption}</p> : null}
            {post.id === data.directoryListing?.referencePostId ? <small>Reylumi · Reference information</small> : null}
            {post.publishedAt ? <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</time> : null}
          </div>
        </button><div className={styles.postMenu}>{renderPostActions?.(post) ?? <PostActions onOpen={() => onPost(post)}/>}</div>
      </article>)}</div>
    </section> : null}
    {reviews.length ? <section className={styles.reviews}>{heading("What our customers say", onReviews, "All experiences")}<p className={styles.reviewIntro}>Selected positive feedback from our customers</p><div className={styles.reviewCards}>{reviews.map(review => <article key={`${review.source}-${review.id}`} className={styles.reviewCard}>
      <blockquote>{review.body}</blockquote><footer><strong>{review.authorDisplayName || "Salon customer"}</strong>{review.verificationStatus === "verified" ? <small>Verified visit</small> : null}<time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</time></footer>
    </article>)}</div></section> : null}
    {showTeam ? <section className={styles.team}>{heading("Our team", onTeam)}<WebsiteTeam members={data.staff.slice(0, 3)} canBook={canBook} onBook={onBook} onOpen={onStaff} salonId={data.profile.salonId}/></section> : null}
    {aboutParagraphs.length ? <section className={styles.about}>{heading(`About ${data.profile.name}`)}<details className={styles.aboutText}><summary>Our story</summary>{aboutParagraphs.map((text, index) => <p key={index}>{text}</p>)}</details></section> : null}
    {feedPhotos.length ? <section className={styles.photoFeed} aria-label="More salon photos"><WebsitePhotoFeed key={data.profile.salonId} photos={feedPhotos} onOpen={openLibraryPhoto} renderActions={libraryActions}/></section> : null}
    <footer className={styles.footer}><strong>{data.profile.name}</strong>{locality ? <span>{locality}</span> : null}</footer>
  </div>;
}

function warm(salonId: string, key: "serviceId" | "staffId", id: string) {
  preloadQuickBooking(`/book/${salonId}?${new URLSearchParams({ source: "public_profile", [key]: id })}`);
}

export function WebsiteServices({ services, posts, canBook, onBook, salonId, showPhotos = false }: {
  services: PublicSalonProfileService[]; posts: ProfileFeedItem[]; canBook: boolean;
  onBook: (context: BookContext) => void; salonId: string; showPhotos?: boolean;
}) {
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  return <div className={styles.serviceCards}>{services.map(service => {
    const photo = showPhotos ? posts.find(post => post.serviceId === service.id && post.publishedAt && post.imageUrl && !isDefaultNailImage(post.imageUrl))?.imageUrl : null;
    const usablePhoto = photo && !failedPhotos.includes(photo);
    return <article key={service.id} className={styles.service}>
      {usablePhoto ? <div className={styles.serviceMedia}><WebsiteImage src={photo} alt={`${service.name} work from this salon`} loading="lazy" onError={() => setFailedPhotos(previous => [...previous, photo])}/></div> : null}
      <div className={styles.serviceBody}><h4>{service.name}</h4>
        <p className={styles.serviceMeta}><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(service.basePrice)}</strong>{service.durationMinutes > 0 ? <span> · {service.durationMinutes} min</span> : null}</p>
        {service.description ? <p className={styles.clamp}>{service.description}</p> : null}
      </div>
      {canBook ? <button aria-label={`Book ${service.name}`} className={styles.book} type="button" onPointerEnter={() => warm(salonId, "serviceId", service.id)} onFocus={() => warm(salonId, "serviceId", service.id)} onClick={() => onBook({ title: "Book service", serviceId: service.id })}>Book <span aria-hidden="true">→</span></button> : null}
    </article>;
  })}{!services.length ? <p className={styles.empty}>No public services available.</p> : null}</div>;
}

export function WebsiteTeam({ members, canBook, onBook, onOpen, salonId }: {
  members: PublicSalonProfileStaff[]; canBook: boolean; onBook: (context: BookContext) => void;
  onOpen?: (member: PublicSalonProfileStaff) => void; salonId: string;
}) {
  const [failedAvatars, setFailedAvatars] = useState<string[]>([]);
  return <div className={styles.teamCards}>{members.map(member => <article key={member.id} className={styles.person}>
    <button aria-label={`View ${member.displayName}'s profile`} type="button" className={styles.personIdentity} onClick={() => onOpen?.(member)}>
      {member.avatarUrl && !failedAvatars.includes(member.avatarUrl) ? <img src={member.avatarUrl} alt="" loading="lazy" onError={() => setFailedAvatars(previous => [...previous, member.avatarUrl!])}/>
        : <span className={styles.initials}>{member.displayName.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</span>}
      <span><strong>{member.displayName}</strong><small>{member.jobTitle || "Salon professional"}</small>{member.specialties?.length ? <small className={styles.clamp}>{member.specialties.slice(0, 2).join(" · ")}</small> : null}</span>
    </button>
    <div className={styles.personActions}><button type="button" className={styles.profileLink} onClick={() => onOpen?.(member)}>View profile</button>
      {canBook && member.onlineBookingEnabled ? <button aria-label={`Book with ${member.displayName}`} className={styles.book} type="button" onPointerEnter={() => warm(salonId, "staffId", member.id)} onFocus={() => warm(salonId, "staffId", member.id)} onClick={() => onBook({ title: "Book with professional", staffId: member.id })}>Book <span aria-hidden="true">→</span></button> : null}
    </div>
  </article>)}{!members.length ? <p className={styles.empty}>No public team members available.</p> : null}</div>;
}
