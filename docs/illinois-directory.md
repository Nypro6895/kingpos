# Illinois business profiles — October 8, 2026

Published on https://reylumi.com/explore?location=IL.

4,436 actual business profiles, all initially unclaimed, with name, street address, city, phone and a published reference introduction. Missing emails remain blank; 11 profiles have a publicly listed email. No owners, staff, prices, reviews, services or online booking were invented. Existing claimed business settings were unchanged, verified by a before/after fingerprint. Repeating the import created zero extra profiles.

| Category | Profiles |
| --- | ---: |
| Nails | 1,215 |
| Hair, including barber businesses | 2,762 |
| Massage | 49 |
| Lashes | 14 |
| Tattoo | 356 |
| Spa | 10 |
| Brows | 60 |
| Waxing | 61 |
| Skin Care | 55 |

Businesses can appear in several categories. Coverage is partial. Nails, hair and tattoo came from 428 public city-directory pages. Other coverage includes official Illinois Massage Envy and European Wax Center locations and 21 beauty studio website contacts. SalonLookup could not be reached during this collection, so its additional Illinois massage/lash/spa listings were not imported.

Sources and collection dates are saved in `data/illinois-profile-sources.json`. Scripts collect contacts, merge duplicates, and prepare imports using `--state IL`. Wisconsin remains supported with the original default command. Imports use an Illinois identity namespace and check state before matching existing independently registered profiles.

An additional search defect was corrected: a two-letter US state filter now requires the profile's actual state, avoiding an `IL` substring match in Wisconsin addresses. Search checks returned Illinois 4,436 and Wisconsin 3,746 with zero results in the wrong state. Eleven focused tests passed, the isolated production build passed, and all nine categories plus the Esthetic Haus contact/claim profile were verified in a mobile browser on the live domain.

## AI illustration assets

Created with the built-in imagegen tool, inspected visually, resized to WebP and saved under `C:/Users/giuse/kingpos/public/images/business-defaults/`. Eight files: `spa-01.webp`, `spa-02.webp`, `brows-01.webp`, `brows-02.webp`, `waxing-01.webp`, `waxing-02.webp`, `skincare-01.webp`, `skincare-02.webp`. All eight returned HTTP 200 on the live website. The existing 52 illustrations remain available for the original five categories.

Real owner images have priority. Illustration selection stays stable per business and varies between the available images for its category. Illustrations use the existing “AI illustration” credit and do not depict the actual business or its work.

Prompt set, first variants: “Use case: photorealistic-natural. Website generic beauty-service illustration for [category]. [scene]. Landscape editorial photography, realistic textures, soft daylight. No logos, no words, no watermark, no claim this depicts any particular business.”

- Spa: peaceful spa interior with linen towels, botanical oils and warm stone basin.
- Brows: close-up adult woman's natural eyebrow grooming with professional clean spoolie, beige studio.
- Waxing: professional beautician applying wax to adult client's forearm with clean wooden applicator, hygienic bright studio.
- Skin Care: adult facial skincare treatment, aesthetician applying cream with soft brush, clean sage green spa.

Prompt set, second variants: “Use case: photorealistic-natural. Generic [category] beauty service website card illustration. [scene]. Landscape composition, natural textures, professional editorial photography. No logos, no words, no watermark.”

- Spa: a serene modern day-spa relaxation lounge, teal velvet seating, pale oak furniture and rolled towels.
- Brows: closeup adult eyebrow shaping with professional tweezers, dark brow hair, warm terracotta studio.
- Waxing: professional waxing still life, amber wax warmer, wooden sticks, lavender towels, gloves, clean salon countertop.
- Skin Care: facial treatment flat lay, white ceramic mask bowl, green botanical serum, folded peach towels, soft daylight.

Production deployment: `dpl_EhTn66xFH26zzJyUFaE1UbHhkkry`, serving both reylumi.com and www.reylumi.com.
