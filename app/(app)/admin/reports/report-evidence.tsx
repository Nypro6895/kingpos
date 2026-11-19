import Image from 'next/image';
import type {AdminPostSafetyCase} from '@/types/admin-post-safety';
import {originalPostHref,formatReviewDate} from '@/lib/post-review-navigation';
import styles from './report-case-view.module.css';
import type {AdminAdReportEvidence} from '@/types/ad-disclosure';

export function AdReportEvidence({evidence}:{evidence:AdminAdReportEvidence}){
 const {target,snapshot,summary}=evidence;
 const href=target.kind==='owner_campaign'?'/admin/plugins/campaigns':'/admin/advertising';
 return <section aria-label="Verified advertising evidence"><h3>Reported advertisement</h3><p className={styles.meta}>Saved selection snapshot · {target.kind==='owner_campaign'?'Salon-sponsored promotion':'Platform placement'}</p>
  <div className={styles.evidence}><div className={styles.evidenceText}><p className={styles.meta}>{snapshot.advertiserName}</p><h3>{snapshot.title||'Promotion without a title'}</h3><p className={styles.body}>{snapshot.caption||'No caption captured.'}</p>
   <dl className={styles.facts}><div><dt>Concern</dt><dd>{evidence.reason.replaceAll('_',' ')}</dd></div><div><dt>Selected at</dt><dd>{formatReviewDate(snapshot.selectedAt)} CT</dd></div><div><dt>Campaign</dt><dd>{target.campaignId}</dd></div><div><dt>Creative</dt><dd>{target.sourceType} · {target.sourceId}</dd></div>{target.salonId&&<div><dt>Salon</dt><dd>{target.salonId}</dd></div>}</dl>
   {evidence.details&&<p className={styles.body}>{evidence.details}</p>}
  </div><div className={styles.visibility}>A report does not automatically hide, pause or refund an advertisement.</div></div>
  <details className={styles.editor}><summary>Selection summary for Support</summary><dl className={styles.facts}><div><dt>Area</dt><dd>{summary.areaLabel||'No area targeting'}</dd></div><div><dt>Location source</dt><dd>{summary.locationSource}</dd></div><div><dt>Search category</dt><dd>{[summary.searchKind,summary.searchCategory].filter(Boolean).join(' · ')||'None'}</dd></div><div><dt>Context</dt><dd>{[summary.page,summary.audience,summary.device].filter(Boolean).join(' · ')}</dd></div></dl><p className={styles.muted}>Precise coordinates, the viewer’s search text and delivery tokens are excluded from this evidence.</p></details>
  <p className={styles.source}><a className={styles.link} href={href}>Open existing campaign review ↗</a></p>
 </section>;
}

export function ReportEvidence({post}:{post:AdminPostSafetyCase}){
 const content=post.current_post??post.content_snapshot,href=originalPostHref(post);
 return <section aria-label="Reported content"><h3>Reported content & evidence</h3><p className={styles.meta}>{post.source_type==='beauty_post'?'Explore · Beauty post':post.source_type==='salon_profile_look'?'Business profile · Look':'Business profile · Update'}{post.salon_name?` · ${post.salon_name}`:''}</p>
 <div className={styles.evidence}><div className={styles.media}>{post.media.length?post.media.map((media,index)=><figure key={media.path}>{media.url?(media.mime?.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(media.path)?<video controls playsInline preload="metadata" src={media.url} aria-label={`Reported video ${index+1}`}/>:<a href={media.url} target="_blank" rel="noreferrer"><Image unoptimized src={media.url} alt={`Reported media ${index+1}`} width={400} height={260}/></a>):<p>Media unavailable. The file may have been removed.</p>}<figcaption>Media {index+1} of {post.media.length}</figcaption></figure>):<p className={styles.muted}>No media attached to this report.</p>}</div><div className={styles.evidenceText}><h3>{content.title||'Post without a title'}</h3>{content.caption&&content.caption!==content.title&&<p className={styles.body}>{content.caption}</p>}<dl className={styles.facts}><div><dt>Posted by</dt><dd>{post.author_name||'Account unavailable'}</dd></div><div><dt>Published</dt><dd>{formatReviewDate(content.published_at??content.created_at)} CT</dd></div></dl></div><div className={styles.visibility}>Content: {post.post_visibility?.replaceAll('_',' ')||'Visibility unavailable'} · {post.hidden_for_reporter?'Hidden for this reporter':'No personal hide recorded'}{!post.current_post?' · Showing the saved report snapshot':''}</div></div>
 <div className={styles.source}>{href?<a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">Open original content ↗</a>:<span className={styles.muted}>Original link unavailable</span>}</div>
 <details className={styles.editor}><summary>Content captured when reported</summary><h3>{post.content_snapshot.title||'No title captured'}</h3><p className={styles.body}>{post.content_snapshot.caption||'No text captured.'}</p><p className={styles.muted}>Report received {formatReviewDate(post.created_at)} CT · Media above uses files still available today.</p></details></section>;
}
