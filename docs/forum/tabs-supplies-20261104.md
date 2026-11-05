# Forum tabs, supplies ads and discovery cards — combined queue

Replace horizontal section scrolling with fixed Latest | Following | Chat | menu. Menu lists active sections plus saved/mine/moderation links; native vertical dragging is retained, no horizontal resizing. Existing Owner bottom nav is unchanged.

Post detail ends with one existing Campaign slot after comments/composer and before suggested posts. Feed advertising with default interval six alternates after 6 and 7 posts (positions 6,13,19,26,...); custom campaign intervals remain supported. Existing admission, targeting and frequency enforcement are retained. Section discovery cards appear sparsely at reserved feed positions, with a random section chosen once on mount so scrolling does not reshuffle content under a finger.

Migration 20261104100000_forum_supplies_campaigns.sql adds three running forum-only supplies text campaigns to existing Admin Advertising. Names: Cọ & dụng cụ làm nails; Dũa & buffer; Khăn & vật tư bàn nails. All have empty href, no click CTA, no prices or product-performance promises. No image assets/dependencies added. Idempotent inserts preserve any subsequent admin edits. Migration is prepared, not applied live.

Verification: TypeScript, 4 Campaign/SQL tests and actual Forum browser fixture at 320/390/428/768 pass. Fixture checks fixed nav/menu, follow, home/back and continuation; ads are stubbed in this fixture, their selection and seed invariants are tested separately. No physical iPhone or authenticated live acceptance claimed. Evidence: artifacts/forum-tabs-ads/{typecheck.txt,verification.txt,browser.txt}. Local screenshots: artifacts/forum-v2/{home-iphone.png,post-iphone.png}.

Queue with forum-continuous-feed-20261103 and Today preview, not a separate deployment. New combined production build and native bundle/registry are required during integration. No production changes performed in this task.
