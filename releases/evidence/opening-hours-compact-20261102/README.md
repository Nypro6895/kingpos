# Opening hours correction — not deployed

The reported screen showed every day's full editor at once. Shared legacy Settings selectors additionally flattened the two time fields and stretched the remove action. This correction replaces that editor with seven compact summaries and expands one day on demand. The existing save action, salon scope, timezone identifier and weeklyHours payload remain unchanged.

- Full-width timezone selector uses a short label only in this editor; other timezone controls retain their existing labels. The salon timezone remains authoritative when the device timezone differs.
- Opens/Closes fields share one row with a 44px remove action. Day Open/Closed, multiple ranges and reopening a temporary Closed draft preserve the existing values and IDs. Changes stay local until saved.
- Explanatory text is under About opening hours. No new scheduling, booking or financial rule is introduced.
- Actual product editor, InlineForm, navigation and all shared Settings styles passed at 320/375/430/768. Tests cover save payload, busy lock, failure/retry, Cancel, split ranges, Closed, Back, device-zone mismatch and revealing a hidden invalid time field. Production build/TypeScript and scoped lint passed.

[Week preview](opening-hours-week.png) and [expanded-day preview](opening-hours-day.png) use synthetic data and transport. They are implementation previews, not screenshots from a released iPhone build. Hosted save and installed/physical iOS acceptance remain for the next authorized combined release. This task did not deploy or change any salon's production settings.
